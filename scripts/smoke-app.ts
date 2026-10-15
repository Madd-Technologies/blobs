#!/usr/bin/env node
/**
 * Runs the app's real session and inbox logic (src/features/sessions, src/features/inbox) against a
 * live dev server, on a throwaway `zz-app` bot: open Bot Chat, stream a turn, answer an approval,
 * stop a turn, re-attach. Everything it creates is deleted.
 *
 *   npm run smoke:app
 */

import { JsonRpcGatewayClient } from '../src/lib/hermes/gateway-client.ts'
import { deleteProfile, deleteSession } from '../src/lib/hermes/rest.ts'
import { call } from '../src/lib/hermes/rpc.ts'
import { advertiseServerRequests, createRequestBridge } from '../src/lib/hermes/server-requests.ts'
import { gatewayWsUrl, type ServerConfig } from '../src/lib/hermes/server.ts'
import { deriveInbox } from '../src/features/inbox/derive.ts'
import { createSessions } from '../src/features/sessions/store.ts'
import { pendingPrompts } from '../src/features/transcript/reduce.ts'
import type { ProfileRow } from '../src/lib/hermes/protocol.ts'


const PROFILE = 'zz-app'
const baseUrl = process.env.HERMES_DEV_URL ?? 'http://127.0.0.1:9119'
const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN
const model = process.env.HERMES_DEV_MODEL

if (!token || !model) {
  console.error('smoke:app: HERMES_DASHBOARD_SESSION_TOKEN and HERMES_DEV_MODEL must be set (run via `npm run smoke:app`).')
  process.exit(2)
}

const config: ServerConfig = { baseUrl, auth: { kind: 'token', token } }
const client = new JsonRpcGatewayClient({ requestIdPrefix: 'app' })
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const results: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${detail ? `: ${detail}` : ''}`)
}

async function waitFor(predicate: () => boolean, ms = 30_000): Promise<boolean> {
  const started = Date.now()

  while (Date.now() - started < ms) {
    if (predicate()) {
      return true
    }

    await sleep(60)
  }

  return predicate()
}

let roster: ProfileRow[] = []
const refreshRoster = async () => void (roster = (await call(client, 'profiles.list', { include_sessions: true })).profiles)

async function main() {
  await client.connect(await gatewayWsUrl(config))

  // Wired as the app wires it: say we can answer server requests (an older server has no such call and
  // keeps using events), and route events and answers through the request bridge.
  const requests = createRequestBridge(client)
  const asked = await advertiseServerRequests(client)
  check('server-request support is detected', true, asked.length ? `server may ask: ${asked.join(', ')}` : 'none: this server asks prompts as events')

  // A bot whose own config points at the dev model: Bot Chat sessions follow the profile's config.
  await deleteProfile(config, PROFILE).catch(() => undefined)
  await call(client, 'profiles.create', { name: PROFILE, description: 'HermesBot app smoke (safe to delete)', clone_from: 'default' })
  const configured = await call(client, 'profiles.configure', { name: PROFILE, model, provider: 'openrouter' })
  check('profiles.configure sets the zz bot to the dev model', !configured.confirm_required, JSON.stringify(configured.applied ?? {}).slice(0, 80))
  await refreshRoster()

  const sessions = createSessions({
    client,
    getConfig: () => config,
    getRosterRow: profile => roster.find(row => row.name === profile),
    onEvent: handler => requests.onEvent(handler),
    requests,
  })
  const bot = () => sessions.store.getState().bots[PROFILE]
  const turnDone = () => bot()?.transcript.running === false && bot()?.transcript.lastTurn !== null

  let storedId: string | null = null

  try {
    // ── open: no canonical Bot Chat exists yet, so it is found or created ───────────────────────
    await sessions.open(PROFILE)
    storedId = bot()?.storedId ?? null
    check('open: creates Bot Chat and resumes it', bot()?.phase === 'ready' && !!bot()?.liveId, `${bot()?.error ?? ''}`)

    // ── a plain turn ──────────────────────────────────────────────────────────────────────────────
    await sessions.send(PROFILE, 'Say hi in 5 words')
    check('send: the turn completes', await waitFor(turnDone), `lastTurn ${bot()?.transcript.lastTurn}`)
    const kinds = bot()?.transcript.items.map(item => item.kind) ?? []
    check('send: user bubble then assistant bubble', kinds[0] === 'user' && kinds.at(-1) === 'assistant', kinds.join(','))
    check('send: the user bubble was confirmed', bot()?.transcript.items[0]?.kind === 'user' && !(bot()?.transcript.items[0] as { pending?: boolean }).pending, '')

    // ── approval: shown in the inbox, answered, and the card settles ─────────────────────────────
    await sessions.send(PROFILE, `Run \`rm -r /tmp/hermesbot-app-${Date.now()}\``)
    const asked = await waitFor(() => pendingPrompts(bot()!.transcript).length > 0)
    check('approval: the prompt arrives as an item', asked, '')

    const { entries } = deriveInbox({ roster, sessions: sessions.store.getState().bots, active: [], polled: {}, knownLiveIds: sessions.knownLiveIds() })
    check('approval: it shows in the inbox for this bot', entries.length === 1 && entries[0]?.profile === PROFILE && entries[0]?.kind === 'approval' && entries[0]?.inline, entries.map(entry => entry.kind).join(','))

    const prompt = pendingPrompts(bot()!.transcript)[0]
    const answered = prompt ? await sessions.respondApproval(PROFILE, prompt.requestId, 'deny') : 'failed'
    check('approval: deny resolves', answered === 'answered', answered)
    check('approval: the turn finishes with a blocked step', await waitFor(turnDone) && JSON.stringify(bot()?.transcript.items).includes('"blocked"'), '')

    // ── stop ─────────────────────────────────────────────────────────────────────────────────────
    await sessions.send(PROFILE, 'Do a slow long task')
    await waitFor(() => (bot()?.transcript.items.at(-1) as { text?: string } | undefined)?.text !== undefined && bot()?.transcript.items.at(-1)?.kind === 'assistant')
    await sleep(900)
    await sessions.stop(PROFILE)
    check('stop: the turn ends interrupted', await waitFor(turnDone, 15_000) && bot()?.transcript.lastTurn === 'interrupted', `lastTurn ${bot()?.transcript.lastTurn}`)

    // ── re-attach rebuilds the same chat from history ────────────────────────────────────────────
    const before = bot()!.transcript.items.filter(item => item.kind === 'user').map(item => (item as { text: string }).text)
    await sessions.reattachAll()
    const after = bot()!.transcript.items.filter(item => item.kind === 'user').map(item => (item as { text: string }).text)
    check('reattach: history comes back intact and nothing is stuck running', JSON.stringify(before) === JSON.stringify(after) && !bot()!.transcript.running && bot()!.phase === 'ready', `${after.length} user messages`)
    check('reattach: the old stuck steps are settled', !JSON.stringify(bot()?.transcript.items).includes('"running"'), '')
  } finally {
    if (bot()?.liveId) {
      await call(client, 'session.close', { session_id: bot()!.liveId! }).catch(() => undefined)
    }

    sessions.dispose()

    if (storedId) {
      await deleteSession(config, storedId, PROFILE).catch(() => undefined)
    }

    await deleteProfile(config, PROFILE).then(
      () => check('cleanup: zz-app deleted', true),
      error => check('cleanup: zz-app deleted', false, String(error)),
    )
  }
}

try {
  await main()
} catch (error) {
  check('smoke:app run', false, error instanceof Error ? error.message : String(error))
  await deleteProfile(config, PROFILE).catch(() => undefined)
}

client.close()
const failed = results.filter(result => !result.ok)
console.log(`\nsmoke:app: ${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
