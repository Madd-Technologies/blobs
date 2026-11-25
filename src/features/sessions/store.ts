import { createStore, type StoreApi } from 'zustand/vanilla'

import { chipOf, messageFor, refusal, uploadAttachment, type PendingFile, type Uploaded } from '../../lib/hermes/attachments.ts'
import { describeError } from '../../lib/hermes/errors.ts'
import { hasOlder } from '../../lib/hermes/history.ts'
import { asHermesEvent, RpcCode, type HermesEvent, type SessionResumeResult } from '../../lib/hermes/protocol.ts'
import { listSessionMessages, listSessionsPage, type StoredMessage } from '../../lib/hermes/rest.ts'
import { call, isRpcCode } from '../../lib/hermes/rpc.ts'
import { HermesHttpError, type ServerConfig } from '../../lib/hermes/server.ts'
import { itemsFromHistory } from '../transcript/history.ts'
import { withLists } from '../transcript/jobs.ts'
import { appendNote, appendOutput, appendUser, dropPendingUser, failUser, initialTranscript, reduceEvent } from '../transcript/reduce.ts'
import type { TranscriptState } from '../transcript/types.ts'
import { INBOX_TITLE, NOT_CHATS } from './chats.ts'
import { createSlashRunner } from './commands.ts'
import { blankSession, buildTranscript } from './hydrate.ts'
import { createPromptResponder } from './prompts.ts'
import { createEventQueue, realTimers, type EventQueue } from './queue.ts'
import { CHATS_PAGE, PAGE_SIZE, summaryOf, type BotSession, type ChatSummary, type ClarifyAnswer, type RespondResult, type SessionsDeps, type SessionsState } from './types.ts'

export { PAGE_SIZE, blankSession, buildTranscript, describeError }
export type { BotSession, ChatSummary, ClarifyAnswer, RespondResult, SessionsDeps, SessionsState }

/** Events that arrive in bulk and can wait for the next flush; everything else flushes at once. */
const BATCHABLE = new Set<HermesEvent['type']>(['message.delta', 'thinking.delta', 'reasoning.delta', 'status.update', 'session.usage', 'agent.terminal.output', 'subagent.tool', 'subagent.progress'])

export function createSessions(deps: SessionsDeps) {
  const listMessages = deps.listMessages ?? listSessionMessages
  const now = deps.now ?? Date.now
  const timers = deps.timers ?? realTimers
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  const store: StoreApi<SessionsState> = createStore<SessionsState>(() => ({ bots: {}, chosen: {} }))
  const liveToProfile = new Map<string, string>()
  const queues = new Map<string, EventQueue<HermesEvent>>()
  const opening = new Map<string, Promise<void>>()
  const pendingTimers = new Set<unknown>()
  let resetEpoch = 0

  function scheduleTimer(fn: () => void, ms: number) {
    const handle = timers.set(() => {
      pendingTimers.delete(handle)
      fn()
    }, ms)
    pendingTimers.add(handle)
  }

  const get = (profile: string): BotSession => store.getState().bots[profile] ?? blankSession(profile)

  function patch(profile: string, change: Partial<BotSession> | ((bot: BotSession) => Partial<BotSession>)) {
    store.setState(state => {
      const bot = state.bots[profile] ?? blankSession(profile)

      return { bots: { ...state.bots, [profile]: { ...bot, ...(typeof change === 'function' ? change(bot) : change) } } }
    })
  }

  function patchTranscript(profile: string, change: (transcript: TranscriptState) => TranscriptState) {
    patch(profile, bot => ({ transcript: change(bot.transcript) }))
  }

  function queueFor(profile: string): EventQueue<HermesEvent> {
    let queue = queues.get(profile)

    if (!queue) {
      queue = createEventQueue<HermesEvent>(
        events => {
          patch(profile, bot => {
            let info = bot.info

            for (const event of events) {
              if (event.type === 'session.info') {
                info = { ...info, ...event.payload }
              }
            }

            return { transcript: events.reduce((state, event) => reduceEvent(state, event, now()), bot.transcript), info }
          })
        },
        event => !BATCHABLE.has(event.type),
        { timers },
      )
      queues.set(profile, queue)
    }

    return queue
  }

  const forwarded = new Set<string>()

  async function reread(profile: string): Promise<void> {
    const config = deps.getConfig()
    const { storedId } = get(profile)

    if (!config || !storedId) {
      return
    }

    try {
      const page = await listMessages(config, storedId, profile, { order: 'latest', limit: PAGE_SIZE, includeCompacted: true })
      const bot = get(profile)

      if (bot.storedId !== storedId || bot.transcript.running) {
        return
      }

      const transcript = buildTranscript(page.messages, { running: false, inflight: null, pending_approval: null, pending_clarify: null })
      patch(profile, {
        rows: page.messages,
        hasOlder: hasOlder(page, PAGE_SIZE),
        transcript: { ...transcript, liveWork: bot.transcript.liveWork, liveHelpers: bot.transcript.liveHelpers, jobs: bot.transcript.jobs },
      })
    } catch {
      // Reply already showed with completion; steps stay unseen.
    }
  }

  const held = new Map<string, HermesEvent[]>()

  function rekey(profile: string, liveId: string) {
    const previous = get(profile).liveId

    if (previous && previous !== liveId) {
      liveToProfile.delete(previous)
    }

    liveToProfile.set(liveId, profile)
  }

  const stopEvents = deps.onEvent(raw => {
    const event = asHermesEvent(raw)
    const profile = event?.session_id ? liveToProfile.get(event.session_id) : undefined

    if (event && profile) {
      const waiting = held.get(profile)

      if (waiting) {
        waiting.push(event)

        return
      }

      queueFor(profile).push(event)

      if (event.type === 'message.complete' && forwarded.delete(profile)) {
        scheduleTimer(() => void reread(profile), 600)
      }

      if (event.type === 'status.update' && event.payload.kind === 'process') {
        void refreshJobs(profile)
      }
    }
  })

  async function refreshJobs(profile: string): Promise<void> {
    const { liveId, transcript } = get(profile)

    if (!liveId || !(transcript.liveWork || transcript.liveHelpers)) {
      return
    }

    const [processes, subagents] = await Promise.all([
      transcript.liveWork
        ? call(deps.client, 'process.list', { session_id: liveId }).then(
            result => result.processes ?? [],
            () => null,
          )
        : null,
      call(deps.client, 'subagent.list', { session_id: liveId }).then(
        result => result.subagents ?? [],
        () => null,
      ),
    ])

    if (get(profile).liveId !== liveId || (!processes && !subagents)) {
      return
    }

    patchTranscript(profile, current => ({ ...current, jobs: withLists(current.jobs, processes, subagents, now()) }))
  }

  // ── opening ────────────────────────────────────────────────────────────────────────────────────

  async function findStoredId(profile: string): Promise<string> {
    const picked = store.getState().chosen[profile]

    if (picked) {
      return picked
    }

    const canonical = deps.getRosterRow(profile)?.canonical_session
    const known = canonical?.resolved_id || canonical?.id

    if (known) {
      return known
    }

    const listed = await call(deps.client, 'session.list', { profile, title: 'Bot Chat', include_hidden: true })
    const existing = listed.sessions[0]
    const id = existing?.resolved_id || existing?.id

    return id ?? (await createBotChat(profile))
  }

  async function createBotChat(profile: string): Promise<string> {
    const created = await call(deps.client, 'session.create', { profile, title: 'Bot Chat', hidden: true, follow_profile_config: true })
    await call(deps.client, 'session.title', { session_id: created.session_id, title: 'Bot Chat' }).catch(() => undefined)

    return created.stored_session_id
  }

  async function resume(profile: string, storedId: string): Promise<{ resume: SessionResumeResult; storedId: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return { resume: await call(deps.client, 'session.resume', { session_id: storedId, profile, omit_messages: true, defer_history: true }), storedId }
      } catch (error) {
        if (isRpcCode(error, RpcCode.Settling) && attempt < 3) {
          await sleep(400 * 2 ** attempt)
          continue
        }

        if (isRpcCode(error, RpcCode.SessionNotFound) && attempt === 0) {
          if (store.getState().chosen[profile] === storedId) {
            setChosen(profile, null)
            storedId = await findStoredId(profile)
          } else {
            storedId = await createBotChat(profile)
          }

          continue
        }

        throw error
      }
    }
  }

  function readPage(config: ServerConfig, profile: string, id: string) {
    return listMessages(config, id, profile, { order: 'latest', limit: PAGE_SIZE, includeCompacted: true }).catch((error: unknown) => {
      if (error instanceof HermesHttpError && error.status === 404 && store.getState().chosen[profile] === id) {
        return { session_id: id, messages: [] as StoredMessage[], pagination: { limit: PAGE_SIZE, offset: 0, order: 'latest', returned: 0 } }
      }

      throw error
    })
  }

  async function readWhole(profile: string, config: NonNullable<ReturnType<SessionsDeps['getConfig']>>, storedId: string, resumed: SessionResumeResult, early?: ReturnType<typeof readPage>) {
    held.set(profile, [])
    rekey(profile, resumed.session_id)

    try {
      const page = await (early ?? readPage(config, profile, storedId))
      queues.get(profile)?.dispose()
      queues.delete(profile)

      const bot = get(profile)
      const liveWork = deps.liveWork?.() ?? false
      const liveHelpers = !liveWork && (deps.liveHelpers?.() ?? false)
      const kept = bot.storedId === storedId ? bot.transcript.jobs : undefined
      let transcript: TranscriptState = {
        ...buildTranscript(page.messages, resumed),
        ...(liveWork ? { liveWork } : {}),
        ...(liveHelpers ? { liveHelpers } : {}),
        ...((liveWork || liveHelpers) && kept ? { jobs: kept } : {}),
      }

      if (bot.storedId === storedId) {
        for (const item of bot.transcript.items) {
          if (item.kind === 'user' && item.pending) {
            transcript = appendUser(transcript, item.text, item.ts ?? now(), item.attachments ?? [])
          }
        }
      }

      patch(profile, {
        phase: 'ready',
        error: null,
        storedId,
        liveId: resumed.session_id,
        info: resumed.info ?? null,
        rows: page.messages,
        hasOlder: hasOlder(page, PAGE_SIZE),
        loadingOlder: false,
        transcript,
      })

      deps.requests?.ingest(resumed.session_id, resumed.open_requests)
      void deps.follow?.(resumed.session_id)

      if (liveWork || liveHelpers) {
        void refreshJobs(profile)
      }
    } finally {
      const waiting = held.get(profile) ?? []
      held.delete(profile)

      for (const event of waiting) {
        queueFor(profile).push(event)
      }
    }
  }

  async function doOpen(profile: string, silent: boolean) {
    const epoch = resetEpoch
    const config = deps.getConfig()

    if (!config) {
      patch(profile, { phase: 'error', error: 'Not connected to a server.' })
      return
    }

    const shown = get(profile)
    const attached = shown.phase === 'ready' && !!shown.liveId && !!shown.storedId

    if (!attached && (!silent || shown.phase === 'idle')) {
      patch(profile, { phase: 'opening', error: null })
    }

    try {
      const found = await findStoredId(profile)

      if (epoch !== resetEpoch) {
        return
      }

      if (attached && found === shown.storedId) {
        const { resume: resumed, storedId } = await resume(profile, found)

        if (epoch !== resetEpoch) {
          return
        }

        if (storedId === found && resumed.session_id === shown.liveId && (await deps.catchUp?.(resumed.session_id))) {
          if (epoch !== resetEpoch) {
            return
          }

          patch(profile, { phase: 'ready', error: null, info: resumed.info ?? get(profile).info })
          deps.requests?.ingest(resumed.session_id, resumed.open_requests)
          void refreshJobs(profile)

          return
        }

        await readWhole(profile, config, storedId, resumed)

        return
      }

      const early = readPage(config, profile, found)
      early.catch(() => undefined)
      const { resume: resumed, storedId } = await resume(profile, found)

      if (epoch !== resetEpoch) {
        return
      }

      await readWhole(profile, config, storedId, resumed, storedId === found ? early : undefined)
    } catch (error) {
      if (epoch !== resetEpoch) {
        return
      }

      patch(profile, bot => ({ phase: bot.phase === 'ready' && silent ? 'ready' : 'error', error: describeError(error) }))
    }
  }

  function open(profile: string, options: { silent?: boolean } = {}): Promise<void> {
    const running = opening.get(profile)

    if (running) {
      return running
    }

    const run = doOpen(profile, !!options.silent).finally(() => opening.delete(profile))
    opening.set(profile, run)

    return run
  }

  // ── choosing a chat ────────────────────────────────────────────────────────────────────────────

  function setChosen(profile: string, storedId: string | null) {
    store.setState(state => {
      const chosen = { ...state.chosen }

      if (storedId) {
        chosen[profile] = storedId
      } else {
        delete chosen[profile]
      }

      return { chosen }
    })
  }

  const mainShown = new Map<string, Pick<BotSession, 'storedId' | 'transcript' | 'rows' | 'hasOlder' | 'info'>>()

  function keepMain(profile: string) {
    const bot = get(profile)

    if (!store.getState().chosen[profile] && bot.phase === 'ready' && bot.storedId) {
      mainShown.set(profile, { storedId: bot.storedId, transcript: bot.transcript, rows: bot.rows, hasOlder: bot.hasOlder, info: bot.info })
    }
  }

  function leaveSide(profile: string) {
    if (!store.getState().chosen[profile]) {
      return
    }

    setChosen(profile, null)

    const live = get(profile).liveId

    if (live) {
      liveToProfile.delete(live)
    }

    queues.get(profile)?.dispose()
    queues.delete(profile)

    const main = mainShown.get(profile)

    patch(profile, main ? { ...main, phase: 'opening', error: null, liveId: null, loadingOlder: false } : { phase: 'idle', error: null, transcript: initialTranscript(), rows: [], hasOlder: false, loadingOlder: false, storedId: null, liveId: null, info: null })
  }

  async function switchTo(profile: string, storedId: string | null): Promise<void> {
    await opening.get(profile)?.catch(() => undefined)

    if (storedId) {
      keepMain(profile)
    }

    setChosen(profile, storedId)

    const previous = get(profile).liveId

    if (previous) {
      liveToProfile.delete(previous)
    }

    queues.get(profile)?.dispose()
    queues.delete(profile)
    patch(profile, { phase: 'opening', error: null, transcript: initialTranscript(), rows: [], hasOlder: false, loadingOlder: false, storedId: null, liveId: null, info: null })

    await open(profile)
  }

  function openChat(profile: string, storedId: string | null): Promise<void> {
    return switchTo(profile, storedId)
  }

  async function openLinked(profile: string, storedId: string): Promise<void> {
    const main = await isMainChat(profile, storedId)
    const chosen = store.getState().chosen[profile]

    if (main ? !chosen : chosen === storedId) {
      return open(profile, { silent: true })
    }

    return switchTo(profile, main ? null : storedId)
  }

  async function isMainChat(profile: string, storedId: string): Promise<boolean> {
    const canonical = deps.getRosterRow(profile)?.canonical_session

    if (canonical) {
      return canonical.id === storedId || canonical.resolved_id === storedId
    }

    const listed = await call(deps.client, 'session.list', { profile, title: 'Bot Chat', include_hidden: true }).catch(() => null)

    return !!listed?.sessions.some(entry => entry.id === storedId || entry.resolved_id === storedId)
  }

  async function newChat(profile: string): Promise<string | null> {
    await opening.get(profile)?.catch(() => undefined)
    const bot = get(profile)

    if (store.getState().chosen[profile] && bot.phase === 'ready' && bot.transcript.items.length === 0 && !bot.hasOlder) {
      return null
    }

    try {
      const created = await call(deps.client, 'session.create', { profile })
      keepMain(profile)
      const previous = get(profile).liveId

      if (previous) {
        liveToProfile.delete(previous)
      }

      liveToProfile.set(created.session_id, profile)
      queues.get(profile)?.dispose()
      queues.delete(profile)
      setChosen(profile, created.stored_session_id)
      patch(profile, {
        phase: 'ready',
        error: null,
        storedId: created.stored_session_id,
        liveId: created.session_id,
        info: created.info ?? null,
        rows: [],
        hasOlder: false,
        loadingOlder: false,
        transcript: initialTranscript(),
      })

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  function forget(profile: string) {
    const live = get(profile).liveId

    if (live) {
      liveToProfile.delete(live)
    }

    queues.get(profile)?.dispose()
    queues.delete(profile)
    setChosen(profile, null)
    store.setState(state => {
      const { [profile]: _gone, ...bots } = state.bots

      return { bots }
    })
  }

  async function listChats(profile: string, offset = 0): Promise<{ chats: ChatSummary[]; total: number; next: number }> {
    const config = deps.getConfig()

    if (!config) {
      throw new Error('Not connected to a server.')
    }

    const page = await (deps.listSessions ?? listSessionsPage)(config, { profile, limit: CHATS_PAGE, offset, excludeSources: [...NOT_CHATS] })

    return {
      chats: page.sessions
        .slice(0, CHATS_PAGE)
        .map(entry => summaryOf({ ...entry, title: entry.title ?? undefined, preview: entry.preview ?? undefined, started_at: entry.started_at ?? undefined, message_count: entry.message_count ?? undefined, source: entry.source ?? undefined })),
      total: page.total,
      next: offset + CHATS_PAGE,
    }
  }

  async function findInbox(profile: string): Promise<ChatSummary | null> {
    const { sessions } = await call(deps.client, 'session.list', { profile, title: INBOX_TITLE, include_hidden: true, limit: 1 })
    const entry = sessions[0]

    return entry ? { ...summaryOf(entry), id: entry.resolved_id || entry.id } : null
  }

  async function deleteChat(profile: string, storedId: string): Promise<string | null> {
    const canonical = deps.getRosterRow(profile)?.canonical_session

    if (storedId === canonical?.id || storedId === canonical?.resolved_id) {
      return 'The main chat can’t be deleted.'
    }

    try {
      const bot = get(profile)

      if (bot.storedId === storedId) {
        if (bot.liveId) {
          await call(deps.client, 'session.close', { session_id: bot.liveId }).catch(() => undefined)
        }

        await switchTo(profile, null)
      }

      if (store.getState().chosen[profile] === storedId) {
        setChosen(profile, null)
      }

      await call(deps.client, 'session.delete', { session_id: storedId, profile })

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  // ── history ────────────────────────────────────────────────────────────────────────────────────

  async function loadOlder(profile: string) {
    const bot = get(profile)
    const config = deps.getConfig()

    if (!config || !bot.storedId || !bot.hasOlder || bot.loadingOlder) {
      return
    }

    patch(profile, { loadingOlder: true })

    try {
      const page = await listMessages(config, bot.storedId, profile, { order: 'latest', limit: PAGE_SIZE, offset: bot.rows.length, includeCompacted: true })
      const rows = [...page.messages, ...bot.rows]

      patch(profile, current => {
        const before = itemsFromHistory(current.rows).length
        const live = current.transcript.items.slice(before)
        const history = itemsFromHistory(rows)

        return {
          rows,
          hasOlder: hasOlder(page, PAGE_SIZE),
          loadingOlder: false,
          transcript: { ...current.transcript, items: [...history, ...live] },
        }
      })
    } catch (error) {
      patch(profile, { loadingOlder: false, error: describeError(error) })
    }
  }

  // ── sending and answering ──────────────────────────────────────────────────────────────────────

  async function send(profile: string, text: string, files: PendingFile[] = [], options: { wire?: string; voiceContext?: string } = {}): Promise<boolean> {
    const trimmed = text.trim()

    if (!trimmed && !files.length) {
      return false
    }

    for (const file of files) {
      const reason = refusal(file)

      if (reason) {
        patchTranscript(profile, transcript => failUser(transcript, reason))

        return false
      }
    }

    if (files.length && !deps.readBase64) {
      patchTranscript(profile, transcript => failUser(transcript, 'Attachments are not available here.'))

      return false
    }

    if (!get(profile).liveId) {
      await open(profile)
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      if (!get(profile).liveId) {
        return false
      }

      patchTranscript(profile, transcript => appendUser(transcript, trimmed, now(), files.map(chipOf)))
      await opening.get(profile)?.catch(() => undefined)
      const liveId = get(profile).liveId

      if (!liveId) {
        patchTranscript(profile, transcript => failUser(transcript, 'Not connected to the server.'))

        return false
      }

      try {
        const uploads: Uploaded[] = []

        for (const file of files) {
          uploads.push(await uploadAttachment(deps.client, liveId, file, await (deps.readBase64 as (uri: string) => Promise<string>)(file.uri)))
        }

        const voice = options.voiceContext === undefined ? {} : { surface: 'voice-live' as const, voice_context: options.voiceContext }

        const submitted = await call(deps.client, 'prompt.submit', { session_id: liveId, text: options.wire ?? messageFor(trimmed, uploads), ...voice })

        if (submitted?.forwarded) {
          forwarded.add(profile)
        }

        return true
      } catch (error) {
        if (attempt === 0 && isRpcCode(error, RpcCode.StaleSession)) {
          patchTranscript(profile, dropPendingUser)
          await open(profile, { silent: true })
          continue
        }

        patchTranscript(profile, transcript => failUser(transcript, describeError(error)))

        return false
      }
    }

    return false
  }

  const runCommand = createSlashRunner({ client: deps.client, get, open, send, patchTranscript })

  function showOutput(profile: string, command: string, text: string, groups?: { title: string; names: string[] }[]) {
    patchTranscript(profile, transcript => appendOutput(transcript, command, text, groups))
  }

  function showNote(profile: string, text: string) {
    patchTranscript(profile, transcript => appendNote(transcript, text))
  }

  async function stop(profile: string): Promise<void> {
    const liveId = get(profile).liveId

    if (liveId) {
      await call(deps.client, 'session.interrupt', { session_id: liveId }).catch(() => undefined)
    }
  }

  const { respondApproval, respondClarify, respondSecret, respondSudo } = createPromptResponder({
    client: deps.client,
    requests: deps.requests,
    get,
    patchTranscript,
  })

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────

  async function reattachAll(): Promise<void> {
    const profiles = Object.values(store.getState().bots)
      .filter(bot => bot.phase === 'ready' || bot.phase === 'error')
      .map(bot => bot.profile)

    await Promise.all(profiles.map(profile => open(profile, { silent: true })))
  }

  function knownLiveIds(): Record<string, string[]> {
    const byBot: Record<string, string[]> = {}

    for (const [liveId, profile] of liveToProfile) {
      ;(byBot[profile] ??= []).push(liveId)
    }

    return byBot
  }

  function reset() {
    resetEpoch++

    for (const handle of pendingTimers) {
      timers.clear(handle)
    }

    pendingTimers.clear()

    for (const queue of queues.values()) {
      queue.dispose()
    }

    queues.clear()
    liveToProfile.clear()
    opening.clear()
    forwarded.clear()
    held.clear()
    mainShown.clear()
    store.setState({ bots: {}, chosen: {} })
  }

  function dispose() {
    stopEvents()
    reset()
  }

  return { store, open, openChat, openLinked, newChat, leaveSide, forget, listChats, findInbox, deleteChat, loadOlder, send, runCommand, showOutput, showNote, stop, respondApproval, respondClarify, respondSecret, respondSudo, reattachAll, knownLiveIds, refreshJobs, reset, dispose }
}

export type Sessions = ReturnType<typeof createSessions>
