#!/usr/bin/env node
/**
 * Seeds the demo Hermes (docs/DEMO.md): signs in the way the app does, then builds the demo world.
 * Run by scripts/demo/demo.sh, not by hand.
 *
 *   bots     create the five bots (before their plugins are installed)
 *   world    put each bot into its state: chats, the routine, the room
 *   status   check the seeded live states are still there (exit 1 if not)
 *
 * Every word the bots say comes from scripts/demo/demo-llm.mjs; this script only sends the messages
 * that start each story, the way a person would in the app.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { signInWithPassword, type AuthDeps } from '../../src/lib/hermes/auth.ts'
import { withCookies } from '../../src/lib/hermes/cookie-fetch.ts'
import { JsonRpcGatewayClient, type GatewayEvent } from '../../src/lib/hermes/gateway-client.ts'
import { buildMembers, createRoom, readLog, roomState, roomsAvailable, sendRoomMessage } from '../../src/lib/hermes/rooms.ts'
import { call } from '../../src/lib/hermes/rpc.ts'
import { advertiseServerRequests, type ServerRequestFrame } from '../../src/lib/hermes/server-requests.ts'
import { gatewayWsUrl, restJson, type ServerConfig } from '../../src/lib/hermes/server.ts'

const baseUrl = process.env.DEMO_URL ?? 'http://127.0.0.1:9219'
const command = process.argv[2]
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

if (command !== 'bots' && command !== 'world' && command !== 'status') {
  console.error('usage: seed.ts bots|world|status (run through scripts/demo/demo.sh)')
  process.exit(2)
}

function loginValue(name: string): string {
  const file = process.env.DEMO_LOGIN

  if (!file) {
    throw new Error('DEMO_LOGIN is not set (run this through scripts/demo/demo.sh)')
  }

  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find(entry => entry.startsWith(`${name}=`))

  if (!line) {
    throw new Error(`${name} is missing from the login file`)
  }

  return line.slice(name.length + 1).trim()
}

// ── the cast ─────────────────────────────────────────────────────────────────────────────────────

// Faces: the website's five (scripts/build-site.mjs), as blobatar seeds whose own colour is the site's.
export const BOTS = [
  {
    name: 'scout',
    title: 'Scout',
    description: 'Research and comparisons',
    shape: 'blobatar:scout-4zi:cloud',
    pinned: true,
    soul: 'You are Scout. You look things up, compare the options and say which one you would pick, briefly.',
  },
  {
    name: 'courier',
    title: 'Courier',
    description: 'Releases and customer requests',
    shape: 'blobatar:courier-6j:droplet',
    pinned: true,
    soul: 'You are Courier. You ship releases and keep the requests board tidy. Ask before anything risky.',
  },
  {
    name: 'forge',
    title: 'Forge',
    description: 'Builds and tests',
    shape: 'blobatar:forge-6v:hexagon',
    pinned: true,
    soul: 'You are Forge. You build, test and fix. Report results in one line.',
  },
  {
    name: 'scribe',
    title: 'Scribe',
    description: 'Docs and release notes',
    shape: 'blobatar:scribe-20r:boxy',
    pinned: false,
    soul: 'You are Scribe. You write release notes, docs and announcements in plain words.',
  },
  {
    name: 'ember',
    title: 'Ember',
    description: 'Morning briefs and routines',
    shape: 'blobatar:ember-26f:round',
    pinned: false,
    soul: 'You are Ember. You write the morning brief and keep the routines running.',
  },
] as const

// ── connection ───────────────────────────────────────────────────────────────────────────────────

const b64url = (bytes: Buffer) => bytes.toString('base64url')
const deps: AuthDeps = {
  sha256: async input => b64url(Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))),
  random: bytes => b64url(randomBytes(bytes)),
  fetch: withCookies(),
}

const auth = await signInWithPassword({ baseUrl, username: loginValue('DEMO_USERNAME'), password: loginValue('DEMO_PASSWORD') }, deps)
const config: ServerConfig = { baseUrl, auth }
const client = new JsonRpcGatewayClient({ requestIdPrefix: 'demo' })
const seen: GatewayEvent[] = []
client.onAny(event => seen.push(event))
// Prompts (approvals, questions) arrive as server requests. They are recorded and deliberately left
// unanswered: the app picks them up when it opens the chat.
const asked: ServerRequestFrame[] = []
client.onServerRequest(frame => asked.push(frame))
const askedIn = (liveId: string, method: string) => asked.some(frame => frame.method === method && frame.params.session_id === liveId)

async function waitFor(predicate: () => boolean, ms = 60_000) {
  const started = Date.now()

  while (Date.now() - started < ms && !predicate()) {
    await sleep(100)
  }

  return predicate()
}

function expect(ok: boolean, what: string) {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${what}`)

  if (!ok) {
    process.exitCode = 1
  }
}

/** Opens a bot's main chat the way the app does (hidden, titled "Bot Chat") and returns its live id. */
async function openChat(profile: string): Promise<string> {
  const created = await call(client, 'session.create', { profile, title: 'Bot Chat', hidden: true, follow_profile_config: true })
  await call(client, 'session.title', { session_id: created.session_id, title: 'Bot Chat' }).catch(() => undefined)

  return created.session_id
}

/** Sends a message and waits for the turn to finish. */
async function turn(liveId: string, text: string) {
  const mark = seen.length
  await call(client, 'prompt.submit', { session_id: liveId, text })
  const done = await waitFor(() => seen.slice(mark).some(event => event.session_id === liveId && event.type === 'message.complete'))
  expect(done, `"${text}" finished`)
  await sleep(300)
}

// ── seed ─────────────────────────────────────────────────────────────────────────────────────────

async function createBots() {
  for (const bot of BOTS) {
    await call(client, 'profiles.create', { name: bot.name, description: bot.description, clone_from: 'default', share_auth: true, soul: bot.soul })
    await call(client, 'tools.configure', { profile: bot.name, action: 'enable', names: ['clarify'] })
    const meta = { title: bot.title, shape: bot.shape, pinned: bot.pinned, custom: true, created: Date.now() }
    await call(client, 'profiles.configure', { name: bot.name, ui_meta: { 'hermes-bots': meta } })
    console.log(`  ok   created ${bot.title}`)
  }

  // The primary profile ("Hermes") stays out of the demo's roster.
  await call(client, 'profiles.configure', { name: 'default', ui_meta: { 'hermes-bots': { hidden: true, custom: true } } })
}

const ROUTINE = {
  name: 'Morning brief',
  prompt: "Write my morning brief: new orders overnight, today's calendar, and anything that needs me.",
  schedule: '0 7 * * *',
  deliver: 'bot-chat',
}

/** Ember: the 7:00 AM routine, run once now so its chat shows a run. */
async function routine() {
  const ember = await openChat('ember')
  const job = await restJson<{ id?: string; job?: { id?: string } }>(config, '/api/cron/jobs?profile=ember', { method: 'POST', body: JSON.stringify(ROUTINE) })
  const id = job.id ?? job.job?.id
  expect(!!id, `Ember has the "${ROUTINE.name}" routine at 7:00 AM`)

  if (!id) {
    return
  }

  // Answers once the run is over; its output is then handed to Ember's chat to sum up, by whichever
  // process gets there first, so look for the summary in the stored chat rather than in live events.
  await restJson(config, `/api/cron/jobs/${id}/trigger?profile=ember`, { method: 'POST' }, { timeoutMs: 120_000 })
  let summed = false

  for (let i = 0; i < 120 && !summed; i++) {
    await sleep(500)
    const { profiles } = await call(client, 'profiles.list', { include_sessions: true })
    summed = (profiles.find(row => row.name === 'ember')?.canonical_session?.message_count ?? 0) >= 2
  }

  expect(summed, `the routine ran and Ember summed it up in its chat (${ember})`)
}

/** A group room with three bots and two exchanges; "@scout can you check the feeds?" is left for a recording. */
async function room() {
  if (!(await roomsAvailable(client))) {
    expect(false, 'group rooms are available')

    return
  }

  const names: Record<string, string> = Object.fromEntries(BOTS.map(bot => [bot.name, bot.title]))
  const members = buildMembers(['scout', 'forge', 'scribe'].map(profile => ({ profile, name: names[profile] ?? profile })))
  const created = await createRoom(client, 'Launch week', members, 'r-launch-week')
  let cursor = 0

  for (const [handle, text] of [
    ['forge', '@forge is the build green?'],
    ['scribe', '@scribe can you draft the announcement?'],
  ] as const) {
    await sendRoomMessage(client, created.room_id, text)
    const member = members.find(entry => entry.handle === handle)
    let answered = false

    for (let i = 0; i < 300 && !answered; i++) {
      await sleep(200)
      const page = await readLog(client, created.room_id, cursor)
      answered = page.events.some(event => event.kind === 'message.member' && event.payload.member_id === member?.member_id)

      if (answered) {
        cursor = page.latest_seq
      }
    }

    expect(answered, `${names[handle]} answered "${text}" in the room`)

    // A message sent while the room is still closing a round is never picked up (Hermes 0.21.6), so let
    // each round finish first.
    let settled = false

    for (let i = 0; i < 150 && !settled; i++) {
      await sleep(200)
      settled = (await roomState(client, created.room_id)).driver_status?.working === false
    }
  }
}

async function world() {
  // Forge: a finished run first, then the long one it is still on.
  const forge = await openChat('forge')
  await turn(forge, 'Clear the cache and run the tests')
  await call(client, 'prompt.submit', { session_id: forge, text: 'Run the full test suite on every browser' })
  expect(await waitFor(() => seen.some(event => event.session_id === forge && event.type === 'tool.start' && JSON.stringify(event).includes('test:browsers'))), 'Forge is running the browser tests')

  // Scribe: a finished reply with a file.
  const scribe = await openChat('scribe')
  await turn(scribe, 'Write the release notes for 1.4')

  await routine()
  await room()

  // Scout: a question with options, waiting for you.
  const scout = await openChat('scout')
  await call(client, 'prompt.submit', { session_id: scout, text: 'Compare the three hosting plans for the new site' })
  expect(await waitFor(() => askedIn(scout, 'clarify')), 'Scout is asking which plan matters most')

  // Courier: a push that needs your OK (last, so it is the newest thing that needs you).
  const courier = await openChat('courier')
  await call(client, 'prompt.submit', { session_id: courier, text: 'Push the release to main' })
  expect(await waitFor(() => askedIn(courier, 'approval')), 'Courier is waiting for your OK to push')
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────

/** Whether the seeded live states are still there. Reads the session list only: it never opens a chat. */
async function status() {
  const { profiles } = await call(client, 'profiles.list', { include_sessions: true })
  const { sessions } = await call(client, 'session.active_list', {})
  const stateOf = (profile: string) => {
    const row = profiles.find(entry => entry.name === profile)
    const keys = new Set([row?.canonical_session?.id, row?.canonical_session?.resolved_id].filter(Boolean))

    return sessions.find(entry => keys.has(entry.session_key))?.status ?? 'not open'
  }

  const want: [string, string, string][] = [
    ['forge', 'working', 'Forge is running the tests'],
    ['scout', 'waiting', 'Scout is waiting for an answer'],
    ['courier', 'waiting', 'Courier is waiting for your OK'],
  ]

  for (const [profile, state, what] of want) {
    const now = stateOf(profile)
    expect(now === state, `${what} (${now})`)
  }
}

try {
  await client.connect(await gatewayWsUrl(config))
  await advertiseServerRequests(client)

  if (command === 'bots') {
    await createBots()
  } else if (command === 'world') {
    await world()
  } else {
    await status()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

client.close()
