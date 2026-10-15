#!/usr/bin/env node
/**
 * Throwaway `zz-*` bots in known states, for looking at the app against the dev server.
 *
 *   npm run dev:seed     create the bots and put each into its state
 *   npm run dev:clean    delete every zz-* bot and its sessions
 *
 * Never touches `default` or any other real profile. States (they persist after this script
 * exits; a pending approval times out on the server after about 5 minutes, so re-seed to refresh):
 *   zz-forge    idle, with a short conversation
 *   zz-courier  waiting on an approval
 *   zz-scout    waiting on a question
 *   zz-scribe   busy on a long task
 *   zz-ember    idle, never used (no history)
 */
import { JsonRpcGatewayClient, type GatewayEvent } from '../src/lib/hermes/gateway-client.ts'
import { deleteProfile } from '../src/lib/hermes/rest.ts'
import { call } from '../src/lib/hermes/rpc.ts'
import { gatewayWsUrl, type ServerConfig } from '../src/lib/hermes/server.ts'

const baseUrl = process.env.HERMES_DEV_URL ?? 'http://127.0.0.1:9119'
const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN
const model = process.env.HERMES_DEV_MODEL
const command = process.argv[2]

if (!token || !model || (command !== 'seed' && command !== 'clean')) {
  console.error('usage: npm run dev:seed | npm run dev:clean (needs HERMES_DASHBOARD_SESSION_TOKEN and HERMES_DEV_MODEL in .env.local)')
  process.exit(2)
}

const config: ServerConfig = { baseUrl, auth: { kind: 'token', token } }
const client = new JsonRpcGatewayClient({ requestIdPrefix: 'dev' })
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const seen: GatewayEvent[] = []
client.onAny(event => seen.push(event))

async function waitFor(predicate: () => boolean, ms = 30_000) {
  const started = Date.now()

  while (Date.now() - started < ms && !predicate()) {
    await sleep(80)
  }

  return predicate()
}

function expect(ok: boolean, what: string) {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${what}`)

  if (!ok) {
    process.exitCode = 1
  }
}

const BOTS = [
  { name: 'zz-forge', title: 'Forge', description: 'Homelab ops', shape: 'hexagon', color: 'hsl(14 90% 63%)', pinned: true },
  { name: 'zz-courier', title: 'Courier', description: 'Deliveries and errands', shape: 'drop', color: 'hsl(217 91% 60%)', pinned: true },
  { name: 'zz-scout', title: 'Scout', description: 'Research', shape: 'cloud', color: 'hsl(172 80% 40%)', pinned: true },
  { name: 'zz-scribe', title: 'Scribe', description: 'Writing', shape: 'squircle', color: 'hsl(330 81% 60%)', pinned: false },
  { name: 'zz-ember', title: 'Ember', description: 'A bot nobody has talked to', shape: 'blobatar', pinned: false },
]

/** Opens a hidden Bot Chat for a profile, the way the app does, and returns its live id. */
async function openChat(profile: string): Promise<string> {
  const created = await call(client, 'session.create', { profile, title: 'Bot Chat', hidden: true, follow_profile_config: true })
  await call(client, 'session.title', { session_id: created.session_id, title: 'Bot Chat' }).catch(() => undefined)

  return created.session_id
}

async function turn(liveId: string, text: string) {
  const mark = seen.length
  await call(client, 'prompt.submit', { session_id: liveId, text })
  await waitFor(() => seen.slice(mark).some(event => event.session_id === liveId && event.type === 'message.complete'))
  await sleep(300)
}

async function seed() {
  await clean(false)

  for (const bot of BOTS) {
    await call(client, 'profiles.create', { name: bot.name, description: bot.description, clone_from: 'default' })
    await call(client, 'profiles.configure', { name: bot.name, model, provider: 'openrouter' })
    await call(client, 'tools.configure', { profile: bot.name, action: 'enable', names: ['clarify'] })
    const meta = { title: bot.title, shape: bot.shape, ...(bot.color ? { color: bot.color } : {}), pinned: bot.pinned, custom: true, created: Date.now() }
    await call(client, 'profiles.configure', { name: bot.name, ui_meta: { 'hermes-bots': meta } })
    console.log(`created ${bot.name} (${bot.title})`)
  }

  // zz-forge: a short, finished conversation.
  const forge = await openChat('zz-forge')
  await turn(forge, 'Say hi in 5 words')
  await turn(forge, 'Give me a markdown summary')

  // zz-courier: stuck on an approval.
  // `rm -r` is one Hermes flags as dangerous; ordinary commands (even `docker compose up`) run unasked.
  const courier = await openChat('zz-courier')
  await call(client, 'prompt.submit', { session_id: courier, text: 'Run `rm -r /tmp/hermesbot-cache`' })
  expect(await waitFor(() => seen.some(event => event.session_id === courier && event.type === 'approval.request')), 'zz-courier asked for approval')

  // zz-scout: waiting on a question.
  const scout = await openChat('zz-scout')
  await call(client, 'prompt.submit', { session_id: scout, text: 'Use clarify to ask me which option' })
  expect(await waitFor(() => seen.some(event => event.session_id === scout && event.type === 'clarify.request')), 'zz-scout asked a question')

  // zz-scribe: busy for the next ten minutes.
  const scribe = await openChat('zz-scribe')
  await call(client, 'prompt.submit', { session_id: scribe, text: 'Work on this forever' })
  expect(await waitFor(() => seen.some(event => event.session_id === scribe && event.type === 'message.delta')), 'zz-scribe is streaming')

  console.log('\nseeded: forge idle, courier needs approval, scout needs an answer, scribe working, ember unused')
}

async function clean(report = true) {
  const { profiles } = await call(client, 'profiles.list', { include_sessions: true })
  const mine = profiles.filter(row => row.name.startsWith('zz-'))

  if (!mine.length) {
    if (report) {
      console.log('nothing to clean')
    }

    return
  }

  // A deleted profile's live sessions would linger in the server's memory: close them first.
  const stored = new Set(mine.flatMap(row => [row.canonical_session?.id, row.canonical_session?.resolved_id]).filter((id): id is string => !!id))
  const { sessions } = await call(client, 'session.active_list', {})

  for (const row of sessions.filter(entry => stored.has(entry.session_key))) {
    await call(client, 'session.close', { session_id: row.id }).catch(() => undefined)
  }

  for (const row of mine) {
    await deleteProfile(config, row.name).then(
      () => console.log(`deleted ${row.name}`),
      error => console.error(`could not delete ${row.name}: ${error}`),
    )
  }
}

try {
  await client.connect(await gatewayWsUrl(config))

  if (command === 'seed') {
    await seed()
  } else {
    await clean()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

client.close()
