import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, it } from 'node:test'

import { withCookies } from './cookie-fetch.ts'
import { fetchProviders, needsRefresh, passwordProvider, refreshAuth, signInWithPassword, SignInError, type AuthDeps, type OAuthAuth } from './auth.ts'
import { gatewayWsUrl, type ServerConfig } from './server.ts'

/**
 * A fake of the Hermes gateway's sign-in endpoints, written from the server source
 * (hermes_cli/dashboard_auth/routes.py, native_flow.py): PKCE is verified, codes are single use, the
 * password step needs the cookie set by the authorize step, and logins are rate limited.
 */
function fakeGateway() {
  const pending = new Map<string, { challenge: string; redirect: string; state: string }>()
  const codes = new Map<string, { challenge: string; user: string }>()
  const access = new Map<string, string>()
  const refresh = new Map<string, string>()
  let failures = 0
  let tokenSeq = 0

  const readBody = async (req: IncomingMessage) => {
    let raw = ''
    for await (const part of req) raw += part
    return raw ? JSON.parse(raw) : {}
  }

  const issue = (user: string) => {
    const accessToken = `at-${++tokenSeq}`
    const refreshToken = `rt-${tokenSeq}`
    access.set(accessToken, user)
    refresh.set(refreshToken, user)
    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, provider: 'basic', user_id: user }
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/providers') {
      return json(200, { providers: [{ name: 'basic', display_name: 'Username and password', supports_password: true }] })
    }

    if (req.method === 'GET' && url.pathname === '/auth/native/authorize') {
      const q = url.searchParams
      if (q.get('provider') !== 'basic') return json(404, { detail: `Unknown provider: ${q.get('provider')}` })
      if (q.get('code_challenge_method') !== 'S256') return json(400, { detail: 'code_challenge_method must be S256' })
      if (!/^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?\//.test(q.get('redirect_uri') ?? '')) return json(400, { detail: 'native redirect_uri host must be a loopback IP literal' })
      const broker = randomUUID()
      pending.set(broker, { challenge: q.get('code_challenge') ?? '', redirect: q.get('redirect_uri') ?? '', state: q.get('state') ?? '' })
      res.writeHead(302, { Location: '/login', 'Set-Cookie': `hermes_session_pkce=${broker}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600` })
      return res.end()
    }

    if (req.method === 'POST' && url.pathname === '/auth/password-login') {
      const body = await readBody(req)
      if (failures >= 3) return json(429, { detail: 'Too many login attempts. Try again shortly.' })
      if (body.username !== 'alex' || body.password !== 'correct horse') {
        failures++
        return json(401, { detail: 'Invalid credentials' })
      }
      const broker = /hermes_session_pkce=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
      const entry = broker ? pending.get(broker) : undefined
      if (!entry) return json(400, { detail: 'Native login expired or unknown; restart sign-in.' })
      pending.delete(broker!)
      const code = randomBytes(24).toString('base64url')
      codes.set(code, { challenge: entry.challenge, user: 'alex' })
      return json(200, { ok: true, next: `${entry.redirect}?code=${code}&state=${encodeURIComponent(entry.state)}` })
    }

    if (req.method === 'POST' && url.pathname === '/auth/native/token') {
      const { code, code_verifier: verifier } = await readBody(req)
      const entry = codes.get(code)
      codes.delete(code) // single use, even when the verifier is wrong
      if (!entry || createHash('sha256').update(verifier ?? '').digest('base64url') !== entry.challenge) {
        return json(400, { detail: 'Invalid or expired authorization code.' })
      }
      return json(200, issue(entry.user))
    }

    if (req.method === 'POST' && url.pathname === '/auth/native/refresh') {
      const { refresh_token: token } = await readBody(req)
      const user = refresh.get(token)
      if (!user) return json(401, { error: 'session_expired', detail: 'Refresh token expired or invalid; start a new sign-in.' })
      refresh.delete(token) // rotation: the old one is dead
      return json(200, issue(user))
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/ws-ticket') {
      const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1]
      if (!bearer || !access.has(bearer)) return json(401, { detail: 'Unauthorized' })
      return json(200, { ticket: `ticket-for-${bearer}`, ttl_seconds: 30 })
    }

    json(404, { detail: 'Not Found' })
  })

  return { server, reset: () => (failures = 0), expireAccess: (token: string) => access.delete(token) }
}

const deps = (extra: Partial<AuthDeps> = {}): AuthDeps => ({
  sha256: async input => createHash('sha256').update(input).digest('base64url'),
  random: bytes => randomBytes(bytes).toString('base64url'),
  fetch: withCookies(),
  ...extra,
})

describe('password sign-in', () => {
  const gateway = fakeGateway()
  let baseUrl = ''

  before(async () => {
    await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`
  })
  after(() => gateway.server.close())
  beforeEach(() => gateway.reset())

  it('lists the providers and picks the one that takes a password', async () => {
    const providers = await fetchProviders(baseUrl)
    assert.equal(passwordProvider(providers)?.name, 'basic')
    assert.equal(passwordProvider([{ name: 'nous', display_name: 'Nous', supports_password: false }]), undefined)
  })

  it('signs in and returns bearer tokens', async () => {
    const auth = await signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse' }, deps())
    assert.equal(auth.kind, 'oauth')
    assert.match(auth.accessToken, /^at-/)
    assert.match(auth.refreshToken, /^rt-/)
    assert.equal(auth.provider, 'basic')
    assert.equal(auth.user, 'alex')
    assert.ok(auth.expiresAt > Date.now() / 1000)
  })

  it('the tokens work: the websocket ticket is minted with the bearer', async () => {
    const auth = await signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse' }, deps())
    const config: ServerConfig = { baseUrl, auth }
    const wsUrl = await gatewayWsUrl(config)
    assert.equal(wsUrl, `ws://${baseUrl.slice('http://'.length)}/api/ws?ticket=ticket-for-${auth.accessToken}`)
  })

  it('rejects a wrong password with a clear error and does not leak which part was wrong', async () => {
    await assert.rejects(
      signInWithPassword({ baseUrl, username: 'alex', password: 'nope' }, deps()),
      (error: SignInError) => error instanceof SignInError && error.kind === 'invalid-credentials' && !/username/i.test(error.message.replace('username or password', '')),
    )
  })

  it('reports rate limiting after repeated failures', async () => {
    for (let i = 0; i < 3; i++) {
      await signInWithPassword({ baseUrl, username: 'alex', password: 'nope' }, deps()).catch(() => undefined)
    }
    await assert.rejects(signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse' }, deps()), (error: SignInError) => error.kind === 'rate-limited')
  })

  it('needs the cookie from the first step: without it the login is refused', async () => {
    const noJar = deps({ fetch: (input, init) => fetch(input, { ...init, redirect: 'manual' }) })
    await assert.rejects(signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse' }, noJar), (error: SignInError) => error.kind === 'server' && /restart sign-in/.test(error.message))
  })

  it('reports an unknown provider as unsupported', async () => {
    await assert.rejects(signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse', provider: 'ghost' }, deps()), (error: SignInError) => error.kind === 'unsupported')
  })

  it('reports an unreachable server', async () => {
    await assert.rejects(
      signInWithPassword({ baseUrl: 'http://127.0.0.1:9', username: 'alex', password: 'x', provider: 'basic' }, deps()),
      (error: SignInError) => error.kind === 'unreachable',
    )
  })

  it('a stolen code is useless without the verifier (PKCE)', async () => {
    // Complete steps 1 and 2 by hand, then try to redeem the code with the wrong verifier.
    const jar = withCookies()
    const challenge = createHash('sha256').update('real-verifier').digest('base64url')
    await jar(`${baseUrl}/auth/native/authorize?provider=basic&code_challenge=${challenge}&code_challenge_method=S256&redirect_uri=${encodeURIComponent('http://127.0.0.1:1/cb')}&state=s`)
    const login = await jar(`${baseUrl}/auth/password-login`, { method: 'POST', body: JSON.stringify({ provider: 'basic', username: 'alex', password: 'correct horse' }) })
    const code = /code=([^&]+)/.exec(((await login.json()) as { next: string }).next)?.[1]
    const attempt = (verifier: string) => fetch(`${baseUrl}/auth/native/token`, { method: 'POST', body: JSON.stringify({ code, code_verifier: verifier }) })
    assert.equal((await attempt('wrong-verifier')).status, 400)
    assert.equal((await attempt('real-verifier')).status, 400, 'the code is consumed by the failed attempt')
  })
})

describe('token refresh', () => {
  const gateway = fakeGateway()
  let baseUrl = ''

  before(async () => {
    await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`
  })
  after(() => gateway.server.close())

  it('rotates the tokens and keeps who is signed in', async () => {
    const first = await signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse' }, deps())
    const second = await refreshAuth(baseUrl, first)
    assert.notEqual(second.accessToken, first.accessToken)
    assert.notEqual(second.refreshToken, first.refreshToken)
    assert.deepEqual([second.user, second.provider], ['alex', 'basic'])
  })

  it('a used refresh token is dead: the user must sign in again', async () => {
    const first = await signInWithPassword({ baseUrl, username: 'alex', password: 'correct horse' }, deps())
    await refreshAuth(baseUrl, first)
    await assert.rejects(refreshAuth(baseUrl, first), (error: SignInError) => error.kind === 'expired')
  })

  it('decides when a refresh is due', () => {
    const auth: OAuthAuth = { kind: 'oauth', accessToken: 'a', refreshToken: 'r', expiresAt: 10_000 }
    assert.equal(needsRefresh(auth, 5_000), false)
    assert.equal(needsRefresh(auth, 9_900), true, 'inside the two-minute margin')
    assert.equal(needsRefresh(auth, 20_000), true, 'already expired')
  })
})

describe('a refresh the network swallows', () => {
  it('fails as unreachable after its deadline instead of holding every later connect', async () => {
    // A fetch that only ends when it is aborted, as a request lost on the way does.
    const hang: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const auth = { kind: 'oauth', accessToken: 'a', refreshToken: 'r', expiresAt: 0 } as OAuthAuth
    const started = Date.now()

    await assert.rejects(refreshAuth('http://127.0.0.1:9', auth, hang, 50), (error: SignInError) => error.kind === 'unreachable' && /did not answer/.test(error.message))
    assert.ok(Date.now() - started < 1000)
  })
})
