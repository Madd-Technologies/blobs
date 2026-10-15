#!/usr/bin/env node
/**
 * End-to-end protocol smoke test against a running dev server (`npm run dev:server`).
 *
 *   npm run smoke
 *
 * Creates a throwaway `zz-smoke` profile (never touches a real profile), pins a hidden test
 * session to the dev model, runs a basic, an approval, an interrupt, a clarify and a failure turn,
 * writes sanitized captures to docs/protocol-captures/, and deletes everything it created.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { JsonRpcGatewayClient, type GatewayEvent } from '../src/lib/hermes/gateway-client.ts'
import { asHermesEvent, type HermesEvent } from '../src/lib/hermes/protocol.ts'
import { listSessionMessages, deleteProfile, deleteSession } from '../src/lib/hermes/rest.ts'
import { assertPinnedModel, call } from '../src/lib/hermes/rpc.ts'
import { sanitizeValue } from '../src/lib/hermes/sanitize.ts'
import { gatewayWsUrl, type ServerConfig } from '../src/lib/hermes/server.ts'

const PROFILE = 'zz-smoke'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const capturesDir = join(root, 'docs/protocol-captures')

const baseUrl = process.env.HERMES_DEV_URL ?? 'http://127.0.0.1:9119'
const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN
const model = process.env.HERMES_DEV_MODEL

if (!token || !model) {
  console.error('smoke: HERMES_DASHBOARD_SESSION_TOKEN and HERMES_DEV_MODEL must be set (run via `npm run smoke`).')
  process.exit(2)
}

const config: ServerConfig = { baseUrl, auth: { kind: 'token', token } }
const client = new JsonRpcGatewayClient({ requestIdPrefix: 'smoke' })
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** Every raw event, in arrival order, so a turn can be sliced out afterwards. */
const raw: GatewayEvent[] = []
client.onAny(event => raw.push(event))

interface Capture {
  rpc: { method: string; params: unknown; result: unknown }[]
  events: GatewayEvent[]
}

let results: { name: string; ok: boolean; detail: string }[] = []
let currentRpc: Capture['rpc'] = []

/** An RPC call that is also recorded into the current capture. */
async function rpc<M extends Parameters<typeof call>[1]>(method: M, params: Parameters<typeof call<M>>[2]) {
  const result = await call(client, method, params)
  currentRpc.push({ method, params, result })

  return result
}

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${detail ? `: ${detail}` : ''}`)
}

function save(name: string, events: GatewayEvent[]) {
  mkdirSync(capturesDir, { recursive: true })
  // Broadcasts (sessions.changed etc.) carry no session and add noise to fixtures.
  const kept = events.filter(event => event.type !== 'sessions.changed')
  const lines = [
    ...currentRpc.map(entry => ({ kind: 'rpc', ...entry })),
    ...kept.map(event => ({ kind: 'event', event })),
  ].map(entry => JSON.stringify(sanitizeValue(entry)))
  writeFileSync(join(capturesDir, `${name}.jsonl`), `${lines.join('\n')}\n`)
  currentRpc = []
}

async function waitFor(predicate: () => boolean, ms = 30_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (predicate()) {
      return true
    }
    await sleep(80)
  }

  return predicate()
}

const typed = (from: number): HermesEvent[] => raw.slice(from).flatMap(event => asHermesEvent(event) ?? [])
const of = <T extends HermesEvent['type']>(events: HermesEvent[], type: T) =>
  events.filter((event): event is Extract<HermesEvent, { type: T }> => event.type === type)

async function main() {
  await client.connect(await gatewayWsUrl(config))
  console.log(`smoke: connected to ${baseUrl}; dev model ${model}`)

  // ── setup: a throwaway profile with the clarify toolset on, and one pinned hidden session ──────
  await deleteProfile(config, PROFILE).catch(() => undefined)
  await rpc('profiles.create', { name: PROFILE, description: 'HermesBot smoke test (safe to delete)', clone_from: 'default' })
  await rpc('tools.configure', { profile: PROFILE, action: 'enable', names: ['clarify'] })

  const roster = await rpc('profiles.list', {})
  // Only the default and throwaway rows are kept: real bots' descriptions and previews are Alex's data.
  const shown = { ...roster, profiles: roster.profiles.filter(row => row.name === 'default' || row.name === PROFILE) }
  currentRpc = [{ method: 'profiles.list', params: {}, result: shown }]
  save('profiles-list', [])

  // A plain directory: Hermes switches to a coding-only toolset (no clarify) when the session's cwd looks
  // like a code workspace, and the dev server itself runs from this repo.
  const cwd = mkdtempSync(join(tmpdir(), 'hermesbot-smoke-cwd-'))
  const created = await rpc('session.create', { profile: PROFILE, title: 'HermesBot smoke', hidden: true, model, provider: 'openrouter', cwd })
  const sid = created.session_id
  const stored = created.stored_session_id
  let resumedLive: string | null = null
  assertPinnedModel(created.info, model!)
  record('session.create pins the dev model', true, `${created.info.model} on ${created.info.provider}`)
  save('session-create', [])

  try {
    // ── 1. basic ──────────────────────────────────────────────────────────────────────────────────
    {
      const mark = raw.length
      const submit = await rpc('prompt.submit', { session_id: sid, text: 'Say hi in 5 words' })
      await waitFor(() => typed(mark).some(event => event.type === 'message.complete'))
      await sleep(400)
      const events = typed(mark)
      const complete = of(events, 'message.complete')[0]
      record('basic: submit streams', submit.status === 'streaming', submit.status)
      record('basic: start, deltas, complete', of(events, 'message.start').length === 1 && of(events, 'message.delta').length > 0 && complete?.payload.status === 'complete', `${of(events, 'message.delta').length} deltas`)
      record('basic: session.info {running:false} follows', of(events, 'session.info').at(-1)?.payload.running === false, '')
      save('basic', raw.slice(mark))
    }

    // ── 2. approval (deny) ────────────────────────────────────────────────────────────────────────
    {
      const mark = raw.length
      const target = `/tmp/hermesbot-smoke-${Date.now()}`
      await rpc('prompt.submit', { session_id: sid, text: `Run \`rm -r ${target}\`` })
      const seen = await waitFor(() => typed(mark).some(event => event.type === 'approval.request'))
      const request = of(typed(mark), 'approval.request')[0]
      record('approval: request arrives', seen && !!request, request ? `choices ${request.payload.choices?.join('/')}` : 'no approval.request (is approvals.mode off?)')

      if (request) {
        const pending = await rpc('approval.pending', { session_id: sid })
        record('approval.pending lists it (without choices)', pending.approvals.some(a => a.request_id === request.payload.request_id) && pending.approvals[0]?.choices === undefined, '')
        const first = await rpc('approval.respond', { session_id: sid, request_id: request.payload.request_id, choice: 'deny' })
        const second = await rpc('approval.respond', { session_id: sid, request_id: request.payload.request_id, choice: 'deny' })
        record('approval.respond resolves once, then reports 0', first.resolved === 1 && second.resolved === 0, `${first.resolved} then ${second.resolved}`)
      }

      await waitFor(() => typed(mark).some(event => event.type === 'message.complete'))
      await sleep(400)
      const events = typed(mark)
      const done = of(events, 'tool.complete')[0]
      const result = typeof done?.payload.result === 'object' ? done.payload.result : undefined
      record('approval: denied tool completes as blocked', result?.status === 'blocked', String(result?.status))
      record('approval: turn still completes', of(events, 'message.complete')[0]?.payload.status === 'complete', '')
      save('approval', raw.slice(mark))
    }

    // ── 3. interrupt ──────────────────────────────────────────────────────────────────────────────
    {
      const mark = raw.length
      await rpc('prompt.submit', { session_id: sid, text: 'Do a slow long task' })
      await waitFor(() => of(typed(mark), 'message.delta').length >= 3)
      const stop = await rpc('session.interrupt', { session_id: sid })
      await waitFor(() => typed(mark).some(event => event.type === 'message.complete'), 15_000)
      await sleep(400)
      const complete = of(typed(mark), 'message.complete')[0]
      record('interrupt: server reports interrupted', stop.status === 'interrupted', stop.status)
      record('interrupt: turn ends with status interrupted', complete?.payload.status === 'interrupted', String(complete?.payload.status))
      save('interrupt', raw.slice(mark))
    }

    // ── 4. clarify ────────────────────────────────────────────────────────────────────────────────
    {
      const mark = raw.length
      await rpc('prompt.submit', { session_id: sid, text: 'Use clarify to ask me which option' })
      const seen = await waitFor(() => typed(mark).some(event => event.type === 'clarify.request'), 20_000)
      const request = of(typed(mark), 'clarify.request')[0]
      record('clarify: request arrives', seen && !!request, request ? JSON.stringify(request.payload).slice(0, 140) : 'no clarify.request')

      if (request) {
        await rpc('clarify.respond', { session_id: sid, request_id: request.payload.request_id, answer: 'Option B' })
      }

      await waitFor(() => typed(mark).some(event => event.type === 'message.complete'))
      await sleep(400)
      record('clarify: turn completes after the answer', of(typed(mark), 'message.complete')[0]?.payload.status === 'complete', '')
      save('clarify', raw.slice(mark))
    }

    // ── 5. failure (the fake model returns HTTP 500; Hermes retries, then reports an error) ──────
    {
      const mark = raw.length
      await rpc('prompt.submit', { session_id: sid, text: 'Please fail now' })
      await waitFor(() => typed(mark).some(event => event.type === 'message.complete'), 60_000)
      await sleep(400)
      const complete = of(typed(mark), 'message.complete')[0]
      record('failure: turn ends with status error', complete?.payload.status === 'error', String(complete?.payload.error ?? complete?.payload.text).slice(0, 120))
      save('failure', raw.slice(mark))
    }

    // ── status and resume ─────────────────────────────────────────────────────────────────────────
    {
      const active = await rpc('session.active_list', {})
      const row = active.sessions.find(entry => entry.id === sid || entry.session_key === stored)
      record('active_list: the idle session is listed', !!row && row.status === 'idle', row ? `${row.status}, keys ${Object.keys(row).join(',')}` : `not found among ${active.sessions.length}`)
      save('active-list', [])

      const same = await rpc('session.resume', { session_id: stored, profile: PROFILE, omit_messages: true })
      record('resume (still live): same live id, not running', same.session_id === sid && same.running === false, `live id ${same.session_id === sid ? 'unchanged' : 'CHANGED'}, keys ${Object.keys(same).join(',')}`)
      save('resume-live', [])

      await rpc('session.close', { session_id: sid })
      const cold = await rpc('session.resume', { session_id: stored, profile: PROFILE, omit_messages: true })
      record('resume (after close): gets a new live id', !!cold.session_id && cold.session_id !== sid, `info.model after cold resume: ${cold.info?.model} on ${cold.info?.provider}`)
      save('resume-cold', [])
      // Keep using the re-keyed id for cleanup below.
      resumedLive = cold.session_id
    }

    // ── transcript over REST ──────────────────────────────────────────────────────────────────────
    {
      const page = await listSessionMessages(config, stored, PROFILE, { order: 'latest', limit: 200, includeCompacted: true })
      const roles = page.messages.map(message => message.role)
      record('transcript: REST returns the turns', page.messages.length > 0 && roles.includes('user') && roles.includes('assistant') && roles.includes('tool'), roles.join(','))
      currentRpc = []
      mkdirSync(capturesDir, { recursive: true })
      writeFileSync(join(capturesDir, 'messages.json'), `${JSON.stringify(sanitizeValue(page), null, 1)}\n`)
    }
  } finally {
    // ── cleanup: always, even after a failed assertion ─────────────────────────────────────────────
    rmSync(cwd, { recursive: true, force: true })
    // Release the live session (the re-keyed one if we resumed) before deleting the stored one.
    await call(client, 'session.close', { session_id: resumedLive ?? sid }).catch(() => undefined)
    await deleteSession(config, stored, PROFILE).then(
      () => record('cleanup: session deleted', true, ''),
      error => record('cleanup: session deleted', false, String(error)),
    )
    await deleteProfile(config, PROFILE).then(
      () => record('cleanup: zz-smoke profile deleted', true, ''),
      error => record('cleanup: zz-smoke profile deleted', false, String(error)),
    )
  }
}

try {
  await main()
} catch (error) {
  record('smoke run', false, error instanceof Error ? error.message : String(error))
  await deleteProfile(config, PROFILE).catch(() => undefined)
}

client.close()
const failed = results.filter(result => !result.ok)
console.log(`\nsmoke: ${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
