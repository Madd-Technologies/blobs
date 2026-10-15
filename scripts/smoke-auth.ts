#!/usr/bin/env node
/**
 * Signs in to a REAL gated Hermes, the way the app does, to check the sign-in module against the server
 * rather than against our own fake of it.
 *
 *   npm run smoke:auth
 *
 * It starts a throwaway `hermes dashboard` with its own empty HERMES_HOME (so no real profile, config or
 * session is touched), bound to this machine's Tailscale address so the gate is genuinely on, with a
 * random password that exists only for this run and is never printed. It stops and deletes everything
 * when done. Quit the dev server first (`npm run dev:stop`): one backend at a time.
 *
 * HERMES_SMOKE_HOST / HERMES_SMOKE_PORT override the address (default: first 100.64/10 address, 9131).
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'

import { fetchProviders, needsRefresh, refreshAuth, SignInError, signInWithPassword, type AuthDeps } from '../src/lib/hermes/auth.ts'
import { withCookies } from '../src/lib/hermes/cookie-fetch.ts'
import { JsonRpcGatewayClient } from '../src/lib/hermes/gateway-client.ts'
import { call } from '../src/lib/hermes/rpc.ts'
import { gatewayWsUrl, HermesHttpError, probeServer, restJson, type ServerConfig } from '../src/lib/hermes/server.ts'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const b64url = (bytes: Buffer) => bytes.toString('base64url')

function tailscaleAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      const [a, b] = entry.address.split('.').map(Number)

      if (entry.family === 'IPv4' && a === 100 && b !== undefined && b >= 64 && b <= 127) {
        return entry.address
      }
    }
  }
}

const host = process.env.HERMES_SMOKE_HOST ?? tailscaleAddress()
const port = Number(process.env.HERMES_SMOKE_PORT ?? 9131)

if (!host) {
  console.error('No Tailscale address found. Set HERMES_SMOKE_HOST to a non-loopback address of this machine.')
  process.exit(2)
}

const baseUrl = `http://${host}:${port}`
const username = 'smoke'
const password = b64url(randomBytes(18))
const TTL_S = 60 // the server's minimum: lets the run see a real expiry

const deps: AuthDeps = {
  sha256: async input => b64url(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))),
  random: bytes => b64url(randomBytes(bytes)),
  fetch: withCookies(),
}

let failed = 0

function expect(ok: boolean, what: string) {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${what}`)

  if (!ok) {
    failed++
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    error => error,
  )
}

const home = await mkdtemp(join(tmpdir(), 'hermesbot-smoke-auth-'))
const hermes = join(homedir(), '.hermes/hermes-agent/venv/bin/hermes')
const log: string[] = []

const server = spawn(hermes, ['dashboard', '--host', host, '--port', String(port), '--skip-build', '--no-open'], {
  env: {
    ...process.env,
    HERMES_HOME: home,
    HERMES_DASHBOARD_BASIC_AUTH_USERNAME: username,
    HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: password,
    HERMES_DASHBOARD_BASIC_AUTH_SECRET: b64url(randomBytes(32)),
    HERMES_DASHBOARD_BASIC_AUTH_TTL_SECONDS: String(TTL_S),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', chunk => log.push(String(chunk)))
}

let exited: number | null = null
server.on('exit', code => (exited = code ?? -1))

async function stop() {
  if (exited === null) {
    server.kill('SIGTERM')

    for (let i = 0; i < 50 && exited === null; i++) {
      await sleep(100)
    }

    if (exited === null) {
      server.kill('SIGKILL')
    }
  }

  await rm(home, { recursive: true, force: true })
}

function scrubbed(text: string) {
  return text.split(password).join('<password>')
}

try {
  console.log(`gated Hermes on ${baseUrl} (throwaway HERMES_HOME, token lifetime ${TTL_S}s)`)

  let probe = await probeServer(baseUrl)

  for (let i = 0; i < 120 && !probe.ok && exited === null; i++) {
    await sleep(500)
    probe = await probeServer(baseUrl)
  }

  if (!probe.ok) {
    console.error(scrubbed(log.join('').split('\n').slice(-20).join('\n')))
    throw new Error(`the server did not come up (${probe.error ?? `exit ${exited}`})`)
  }

  expect(probe.authRequired === true, `probe reports a login is required (Hermes ${probe.version ?? '?'})`)

  const providers = await fetchProviders(baseUrl)
  expect(providers.some(p => p.name === 'basic' && p.supports_password), 'the server advertises the password provider')

  const wrong = await rejection(signInWithPassword({ baseUrl, username, password: `${password}x` }, { ...deps, fetch: withCookies() }))
  expect(wrong instanceof SignInError && wrong.kind === 'invalid-credentials', `a wrong password is refused as invalid-credentials (${wrong instanceof SignInError ? wrong.kind : String(wrong)})`)

  const auth = await signInWithPassword({ baseUrl, username, password }, { ...deps, fetch: withCookies() })
  const now = () => Date.now() / 1000
  const lifetime = auth.expiresAt - now()
  expect(lifetime > 0 && lifetime <= TTL_S + 5, `signed in; the access token lives ${Math.round(lifetime)}s`)
  expect(auth.provider === 'basic' && auth.user === username, 'the session remembers the provider and user')

  const config: ServerConfig = { baseUrl, auth }

  // REST: the bearer is what lets the request through.
  const anonymous = await rejection(restJson({ baseUrl, auth: { kind: 'token', token: 'nope' } }, '/api/cron/jobs?profile=default'))
  expect(anonymous instanceof HermesHttpError && anonymous.status === 401, `REST without a valid login is refused (${anonymous instanceof HermesHttpError ? anonymous.status : String(anonymous)})`)
  const jobs = await rejection(restJson(config, '/api/cron/jobs?profile=default'))
  expect(jobs === undefined || (jobs instanceof HermesHttpError && jobs.status !== 401), 'REST with the bearer is accepted')

  // Websocket: ticket, connect, one RPC.
  const client = new JsonRpcGatewayClient({ requestIdPrefix: 'smoke' })
  await client.connect(await gatewayWsUrl(config))
  const roster = await call(client, 'profiles.list', {})
  expect(Array.isArray(roster.profiles) && roster.profiles.length > 0, `the websocket opened with a ticket and profiles.list answered (${roster.profiles.length} profile)`)
  client.close()

  // Refresh. Tokens are signed from their timestamps, so ask a second later to get a different one.
  await sleep(1_200)
  const second = await refreshAuth(baseUrl, auth)
  expect(second.user === username && second.provider === 'basic', `a refresh keeps who is signed in (user ${second.user}, provider ${second.provider})`)
  expect(second.accessToken !== auth.accessToken, 'a refresh gives a different access token')
  expect(second.expiresAt > auth.expiresAt, `a refresh pushes the expiry out (+${Math.round(second.expiresAt - auth.expiresAt)}s)`)
  const third = await refreshAuth(baseUrl, second)
  expect(!!third.accessToken, 'the refreshed refresh token can be used again')

  const bogus = await rejection(refreshAuth(baseUrl, { ...auth, refreshToken: 'not-a-real-token' }))
  expect(bogus instanceof SignInError && bogus.kind === 'expired', `a refresh token the server does not know is "expired" (${bogus instanceof SignInError ? bogus.kind : String(bogus)})`)

  // Real expiry: wait out the first access token (HERMES_SMOKE_QUICK=1 skips this).
  if (!process.env.HERMES_SMOKE_QUICK) {
    expect(!needsRefresh(third, now(), 0), 'the newest token is still valid')
    const wait = Math.max(0, auth.expiresAt - now()) + 3
    console.log(`      waiting ${Math.ceil(wait)}s for the first access token to expire…`)
    await sleep(wait * 1000)

    const stale = await rejection(gatewayWsUrl(config))
    console.log(`      expired bearer on the ticket request: ${stale instanceof HermesHttpError ? `HTTP ${stale.status}` : stale === undefined ? 'accepted anyway' : String(stale)}`)
    expect(stale instanceof HermesHttpError && stale.status === 401, 'an expired access token is turned down with 401 (the app renews and retries on that)')

    const renewed = await refreshAuth(baseUrl, auth)
    const url = await gatewayWsUrl({ baseUrl, auth: renewed })
    expect(url.includes('ticket='), 'after renewing, a websocket ticket is issued again')
  }

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error(scrubbed(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
} finally {
  await stop()
}
