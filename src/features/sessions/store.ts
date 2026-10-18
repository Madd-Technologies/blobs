/**
 * Bot chat sessions: opening a bot's Bot Chat, loading its history, streaming a turn, answering
 * prompts. Framework-free (zustand/vanilla) with every dependency injected, so it is tested against a
 * scripted gateway and runs unchanged in the app. `src/stores/sessions.ts` wires the real one.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

import { JsonRpcGatewayError, type GatewayEvent } from '../../lib/hermes/gateway-client.ts'
import { asHermesEvent, RpcCode, type HermesEvent, type ProfileRow, type SessionInfo, type SessionResumeResult } from '../../lib/hermes/protocol.ts'
import { listSessionMessages, type StoredMessage } from '../../lib/hermes/rest.ts'
import { call, isRpcCode, type RpcClient, type RpcMethods } from '../../lib/hermes/rpc.ts'
import type { RequestBridge } from '../../lib/hermes/server-requests.ts'
import { HermesHttpError, type ServerConfig } from '../../lib/hermes/server.ts'
import { historyWithOpenTurn, itemsFromHistory, settleStaleSteps, turnIsChatter, turnIsStored } from '../transcript/history.ts'
import { routineDelivery } from '../transcript/injected.ts'
import { withLists } from '../transcript/jobs.ts'
import { chipOf, messageFor, refusal, uploadAttachment, type PendingFile, type Uploaded } from '../../lib/hermes/attachments.ts'
import { answerPrompt, appendError, appendOutput, appendUser, dropPendingUser, expirePrompt, failUser, finishOutput, initialTranscript, reduceEvent, revealLastReply, startOutput } from '../transcript/reduce.ts'
import { skillInvocation } from '../transcript/userContent.ts'
import { dispatchOf, parseSlash, REWRITES_CHAT, stripAnsi } from '../../lib/hermes/slash.ts'
import type { Item, TranscriptState } from '../transcript/types.ts'
import { INBOX_TITLE } from './chats.ts'
import { createEventQueue, realTimers, type EventQueue, type QueueTimers } from './queue.ts'

/** Rows fetched per page; the chat opens on the newest page and pages back from there. */
export const PAGE_SIZE = 200

export interface BotSession {
  profile: string
  /** `opening` shows the loading state only the first time; a re-open keeps the old transcript on screen. */
  phase: 'idle' | 'opening' | 'ready' | 'error'
  error: string | null
  /** The stored id (REST and `canonical_session.id`). */
  storedId: string | null
  /** The live id (every RPC). Changes when the session is resumed after being closed. */
  liveId: string | null
  transcript: TranscriptState
  info: Partial<SessionInfo> | null
  /** The newest-first pages loaded so far, kept so older pages can be merged in order. */
  rows: StoredMessage[]
  hasOlder: boolean
  loadingOlder: boolean
}

export interface SessionsState {
  bots: Record<string, BotSession>
  /**
   * The side chat each bot is showing, when it is not showing its main chat (Bot Chat): profile -> stored id. Leaving the bot
   * returns it to its main chat, unless the person chose to come back to the last side chat (then the app keeps this).
   */
  chosen: Record<string, string>
}

/** A stored chat as the history list shows it. */
export interface ChatSummary {
  id: string
  title: string
  preview: string
  /** Epoch seconds. */
  startedAt: number
  messageCount: number
  /** Where it was started: `tui`, `cron`, a chat platform... */
  source: string
}

/** A `session.list` row as the history list shows it. */
function summaryOf(entry: RpcMethods['session.list']['result']['sessions'][number]): ChatSummary {
  return {
    id: entry.id,
    title: entry.title ?? '',
    preview: entry.preview ?? '',
    startedAt: entry.started_at ?? 0,
    messageCount: entry.message_count ?? 0,
    source: entry.source ?? '',
  }
}

export interface SessionsDeps {
  client: RpcClient
  getConfig: () => ServerConfig | null
  getRosterRow: (profile: string) => ProfileRow | undefined
  /** Subscribe to raw gateway events; returns the unsubscribe function. */
  onEvent: (handler: (event: GatewayEvent) => void) => () => void
  /**
   * For a Hermes that asks prompts as requests (0.21.5+): answers them, and re-delivers the ones still
   * open after a resume. Absent, every prompt is answered with its RPC (Hermes 0.21.0).
   */
  requests?: Pick<RequestBridge, 'answer' | 'ingest'>
  listMessages?: typeof listSessionMessages
  /** A picked file's bytes as base64 (the phone's file system). Needed only to send attachments. */
  readBase64?: (uri: string) => Promise<string>
  now?: () => number
  timers?: QueueTimers
  /** Waits between retries of a settling session. */
  sleep?: (ms: number) => Promise<void>
  /**
   * The server reports work that outlives a step (Hermes 0.22+, `lib/hermes/capabilities.ts`): background commands and helpers
   * are then followed. Absent or false, every step reads as it always has.
   */
  liveWork?: () => boolean
  /**
   * The server reports helpers' progress (Hermes 0.21.5+): helpers are then followed even where background commands are not.
   */
  liveHelpers?: () => boolean
}

export type RespondResult = 'answered' | 'expired' | 'failed'

/** One answer to one question of a clarify prompt. */
export interface ClarifyAnswer {
  /** The question's `qid`; omit for the single-question form. */
  questionId?: string
  answer: string
}

/** Events that arrive in bulk and can wait for the next flush; everything else flushes at once. */
const BATCHABLE = new Set<HermesEvent['type']>(['message.delta', 'thinking.delta', 'reasoning.delta', 'status.update', 'session.usage', 'agent.terminal.output', 'subagent.tool', 'subagent.progress'])

export function blankSession(profile: string): BotSession {
  return { profile, phase: 'idle', error: null, storedId: null, liveId: null, transcript: initialTranscript(), info: null, rows: [], hasOlder: false, loadingOlder: false }
}

/** A short, human sentence for an error from the gateway or the network. */
export function describeError(error: unknown): string {
  if (error instanceof JsonRpcGatewayError) {
    if (error.code === RpcCode.Refused) {
      return 'This chat is open on another device. Close it there, or try again.'
    }

    if (error.code === RpcCode.TooLarge) {
      return 'This chat is too large to open.'
    }

    return error.message || 'The server returned an error.'
  }

  if (error instanceof Error) {
    return error.message === 'gateway not connected' ? 'Not connected to the server.' : error.message
  }

  return String(error)
}

/** What starts a turn: your message, or something that woke the bot (a finished process, another bot's message). */
const startsTurn = (item: Item): boolean => item.kind === 'user' || item.kind === 'note' || item.kind === 'teammate'

/** True when this reply text is already in the transcript after the latest user message. */
function alreadyShown(items: Item[], partial: string): boolean {
  const wanted = partial.trim()
  const lastUser = items.map(startsTurn).lastIndexOf(true)

  // A tool call in flight means the model is past this text.
  if (items.at(-1)?.kind === 'activity') {
    return true
  }

  return items.slice(lastUser + 1).some(item => item.kind === 'assistant' && item.text.trim().startsWith(wanted))
}

/** What `session.resume` and the stored rows say, as a transcript. */
export function buildTranscript(rows: StoredMessage[], resume: Pick<SessionResumeResult, 'running' | 'inflight' | 'pending_approval' | 'pending_clarify'>): TranscriptState {
  const read = historyWithOpenTurn(rows)
  // The turn running now is the last stored one (and not a newer one whose first row is not stored yet).
  const runningIsLast = resume.running && turnIsStored(rows, resume.inflight?.user)
  // A routine's turn the rows end with is over unless it is the one running: its summary shows.
  let items = read.routineFrom !== null && !runningIsLast ? revealLastReply(read.items, read.routineFrom) : read.items

  if (!resume.running) {
    items = settleStaleSteps(items)
  }

  let transcript = initialTranscript(items)

  if (resume.running) {
    transcript = { ...transcript, running: true, phase: 'thinking' }
    const partial = resume.inflight?.assistant
    // A turn another bot started: what the bot is writing now is for that bot. Nothing of it is shown, now or as it goes on.
    // A routine's turn is the same until it ends, when its last reply (the summary for the person) shows.
    const betweenBots = turnIsChatter(rows, resume.inflight?.user)

    if (betweenBots) {
      const routineFrom = runningIsLast ? read.routineFrom : routineDelivery(resume.inflight?.user ?? '') !== null ? items.length : null
      transcript = { ...transcript, chatterFrom: items.length, routineFrom }
    }

    // The reply being typed is not stored yet: resume hands it back so the bubble carries on. But once
    // the model has moved on to a tool call, that text is already in history (stored with the call), so
    // adding it again would show the same reply twice.
    if (!betweenBots && partial?.trim() && !alreadyShown(items, partial)) {
      transcript = reduceEvent(transcript, { type: 'message.delta', payload: { text: partial } })
    }
  } else if (resume.inflight?.status === 'error' && resume.inflight.error && startsTurn(items.at(-1) as Item)) {
    // `inflight` keeps the last failure even when idle, so only show it if that turn never got a reply.
    transcript = reduceEvent(transcript, { type: 'error', payload: { message: resume.inflight.error } })
  }

  if (resume.pending_approval) {
    transcript = reduceEvent(transcript, { type: 'approval.request', payload: resume.pending_approval })
  }

  if (resume.pending_clarify) {
    transcript = reduceEvent(transcript, { type: 'clarify.request', payload: resume.pending_clarify })
  }

  return transcript
}

export function createSessions(deps: SessionsDeps) {
  const listMessages = deps.listMessages ?? listSessionMessages
  const now = deps.now ?? Date.now
  const timers = deps.timers ?? realTimers
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  const store: StoreApi<SessionsState> = createStore<SessionsState>(() => ({ bots: {}, chosen: {} }))
  const liveToProfile = new Map<string, string>()
  const queues = new Map<string, EventQueue<HermesEvent>>()
  const opening = new Map<string, Promise<void>>()

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

  // ── live events ────────────────────────────────────────────────────────────────────────────────

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

  const stopEvents = deps.onEvent(raw => {
    const event = asHermesEvent(raw)
    const profile = event?.session_id ? liveToProfile.get(event.session_id) : undefined

    if (event && profile) {
      queueFor(profile).push(event)

      // A background job's news (it finished, failed or sent a heartbeat): the list has its exit status and output.
      if (event.type === 'status.update' && event.payload.kind === 'process') {
        void refreshJobs(profile)
      }
    }
  })

  /**
   * What the server is still running for a bot's open chat: its background commands (Hermes 0.22+) and its helpers (0.21.5+),
   * merged into the jobs its steps started. Run when the chat opens, when a job sends news, and every so often while one runs on
   * screen.
   */
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
    // The title is how Bot Chat is found again, and `session.create` does not always keep it.
    await call(deps.client, 'session.title', { session_id: created.session_id, title: 'Bot Chat' }).catch(() => undefined)

    return created.stored_session_id
  }

  /** `session.resume`, retrying while the session is settling and recreating Bot Chat if it is gone. */
  async function resume(profile: string, storedId: string): Promise<{ resume: SessionResumeResult; storedId: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return { resume: await call(deps.client, 'session.resume', { session_id: storedId, profile, omit_messages: true }), storedId }
      } catch (error) {
        if (isRpcCode(error, RpcCode.Settling) && attempt < 3) {
          await sleep(400 * 2 ** attempt)
          continue
        }

        if (isRpcCode(error, RpcCode.SessionNotFound) && attempt === 0) {
          if (store.getState().chosen[profile] === storedId) {
            // A chat that is gone (deleted elsewhere, or a new one nobody wrote in): fall back to the main chat.
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

  async function doOpen(profile: string, silent: boolean) {
    const config = deps.getConfig()

    if (!config) {
      patch(profile, { phase: 'error', error: 'Not connected to a server.' })
      return
    }

    if (!silent || get(profile).phase === 'idle') {
      patch(profile, { phase: 'opening', error: null })
    }

    try {
      const found = await findStoredId(profile)
      const { resume: resumed, storedId } = await resume(profile, found)
      const page = await listMessages(config, storedId, profile, { order: 'latest', limit: PAGE_SIZE, includeCompacted: true }).catch((error: unknown) => {
        // A chat nobody has written in yet has no stored row, so there is nothing to read: it opens empty.
        if (error instanceof HermesHttpError && error.status === 404 && store.getState().chosen[profile] === storedId) {
          return { session_id: storedId, messages: [] as StoredMessage[], pagination: { limit: PAGE_SIZE, offset: 0, order: 'latest', returned: 0 } }
        }

        throw error
      })

      // Re-key by the id the server returned: it is new if the session had been closed.
      const previous = get(profile).liveId

      if (previous && previous !== resumed.session_id) {
        liveToProfile.delete(previous)
      }

      liveToProfile.set(resumed.session_id, profile)
      queues.get(profile)?.dispose()
      queues.delete(profile)

      const liveWork = deps.liveWork?.() ?? false
      const liveHelpers = !liveWork && (deps.liveHelpers?.() ?? false)
      // The same chat opened again keeps the jobs it was following (a helper count the lists cannot give back).
      const kept = get(profile).storedId === storedId ? get(profile).transcript.jobs : undefined

      patch(profile, {
        phase: 'ready',
        error: null,
        storedId,
        liveId: resumed.session_id,
        info: resumed.info ?? null,
        rows: page.messages,
        hasOlder: page.pagination.returned >= PAGE_SIZE,
        loadingOlder: false,
        transcript: {
          ...buildTranscript(page.messages, resumed),
          ...(liveWork ? { liveWork } : {}),
          ...(liveHelpers ? { liveHelpers } : {}),
          ...((liveWork || liveHelpers) && kept ? { jobs: kept } : {}),
        },
      })

      // Prompts still waiting on a person (Hermes 0.21.5+): show them, and be able to answer them.
      deps.requests?.ingest(resumed.session_id, resumed.open_requests)

      if (liveWork || liveHelpers) {
        void refreshJobs(profile)
      }
    } catch (error) {
      // A failed silent re-open keeps what was on screen; the first open shows the error.
      patch(profile, bot => ({ phase: bot.phase === 'ready' && silent ? 'ready' : 'error', error: describeError(error) }))
    }
  }

  /** Opens (or re-opens) a bot's Bot Chat. Safe to call repeatedly: concurrent calls share one run. */
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

  /**
   * What a bot's main chat showed when a side chat replaced it, so going back to it shows it at once instead of the side chat
   * until the main one has loaded again.
   */
  const mainShown = new Map<string, Pick<BotSession, 'storedId' | 'transcript' | 'rows' | 'hasOlder' | 'info'>>()

  /** The bot is about to show a side chat: keep what its main chat shows, if that is what is on screen. */
  function keepMain(profile: string) {
    const bot = get(profile)

    if (!store.getState().chosen[profile] && bot.phase === 'ready' && bot.storedId) {
      mainShown.set(profile, { storedId: bot.storedId, transcript: bot.transcript, rows: bot.rows, hasOlder: bot.hasOlder, info: bot.info })
    }
  }

  /**
   * Leaves a side chat: the bot goes back to its main chat, which shows at once (as it was when the side chat replaced it) while
   * it is opened again. Nothing is closed or deleted.
   */
  function leaveSide(profile: string) {
    if (!store.getState().chosen[profile]) {
      return
    }

    setChosen(profile, null)

    // The side chat's events must not reach the main chat.
    const live = get(profile).liveId

    if (live) {
      liveToProfile.delete(live)
    }

    queues.get(profile)?.dispose()
    queues.delete(profile)

    const main = mainShown.get(profile)

    patch(profile, main ? { ...main, phase: 'opening', error: null, liveId: null, loadingOlder: false } : { phase: 'idle', error: null, transcript: initialTranscript(), rows: [], hasOlder: false, loadingOlder: false, storedId: null, liveId: null, info: null })
  }

  /** A bot's chat view changes to another chat: nothing of the old one may show while the new one loads. */
  async function switchTo(profile: string, storedId: string | null): Promise<void> {
    // A re-open already under way would finish by putting the old chat back.
    await opening.get(profile)?.catch(() => undefined)

    if (storedId) {
      keepMain(profile)
    }

    setChosen(profile, storedId)

    // Let go of the old chat's live id first: a turn still running there must not write into the new chat.
    const previous = get(profile).liveId

    if (previous) {
      liveToProfile.delete(previous)
    }

    queues.get(profile)?.dispose()
    queues.delete(profile)
    patch(profile, { phase: 'opening', error: null, transcript: initialTranscript(), rows: [], hasOlder: false, loadingOlder: false, storedId: null, liveId: null, info: null })

    await open(profile)
  }

  /** Opens another stored chat of this bot, or its main chat (Bot Chat) with `null`. */
  function openChat(profile: string, storedId: string | null): Promise<void> {
    return switchTo(profile, storedId)
  }

  /**
   * Shows the chat a link names (a notification's): the bot's main chat when the id is that one, else that side chat. A chat
   * already on screen is only re-attached, so tapping a notification for the chat you are in does not reload it.
   */
  async function openLinked(profile: string, storedId: string): Promise<void> {
    const main = await isMainChat(profile, storedId)
    const chosen = store.getState().chosen[profile]

    if (main ? !chosen : chosen === storedId) {
      return open(profile, { silent: true })
    }

    return switchTo(profile, main ? null : storedId)
  }

  /** Whether this stored id is the bot's main chat (Bot Chat). Asks the server only when the roster has not loaded yet. */
  async function isMainChat(profile: string, storedId: string): Promise<boolean> {
    const canonical = deps.getRosterRow(profile)?.canonical_session

    if (canonical) {
      return canonical.id === storedId || canonical.resolved_id === storedId
    }

    const listed = await call(deps.client, 'session.list', { profile, title: 'Bot Chat', include_hidden: true }).catch(() => null)

    return !!listed?.sessions.some(entry => entry.id === storedId || entry.resolved_id === storedId)
  }

  /**
   * Starts a fresh chat with this bot and shows it. The old chat is left as it is (a turn it is running carries on
   * at the server); it stays in the history. Returns an error to show, or null.
   */
  async function newChat(profile: string): Promise<string | null> {
    await opening.get(profile)?.catch(() => undefined)
    const bot = get(profile)

    // A side chat nobody has written in yet is already a fresh one.
    if (store.getState().chosen[profile] && bot.phase === 'ready' && bot.transcript.items.length === 0 && !bot.hasOlder) {
      return null
    }

    try {
      // Not hidden: unlike Bot Chat, an ordinary chat shows in the server's own session list too.
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

  /** A bot was deleted: drop everything held for it, including which chat it was on. */
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

  /** The bot's stored chats, newest first (routines and sub-agents are left out by the caller). */
  async function listChats(profile: string): Promise<ChatSummary[]> {
    const { sessions } = await call(deps.client, 'session.list', { profile, limit: 80 })

    return sessions.map(summaryOf)
  }

  /**
   * The bot's inbox (see `INBOX_TITLE`), or null when it has none. Found by its exact title, which the server looks up
   * outside the newest-80 window: a bot that runs routines all day would push it out of `listChats`.
   */
  async function findInbox(profile: string): Promise<ChatSummary | null> {
    const { sessions } = await call(deps.client, 'session.list', { profile, title: INBOX_TITLE, include_hidden: true })
    const entry = sessions[0]

    return entry ? { ...summaryOf(entry), id: entry.resolved_id || entry.id } : null
  }

  /** Deletes a stored chat. The main chat cannot be deleted. Returns an error to show, or null. */
  async function deleteChat(profile: string, storedId: string): Promise<string | null> {
    const canonical = deps.getRosterRow(profile)?.canonical_session

    if (storedId === canonical?.id || storedId === canonical?.resolved_id) {
      return 'The main chat can’t be deleted.'
    }

    try {
      const bot = get(profile)

      if (bot.storedId === storedId) {
        // The server refuses to delete a chat that is live here, and nothing should be left pointing at it.
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
        // The older page is merged by rebuilding the history part, so a tool call at the page boundary
        // still finds its result. Live items after the history are kept as they are.
        const before = itemsFromHistory(current.rows).length
        const live = current.transcript.items.slice(before)
        const history = itemsFromHistory(rows)

        return {
          rows,
          hasOlder: page.pagination.returned >= PAGE_SIZE,
          loadingOlder: false,
          transcript: { ...current.transcript, items: [...history, ...live] },
        }
      })
    } catch (error) {
      patch(profile, { loadingOlder: false, error: describeError(error) })
    }
  }

  // ── sending and answering ──────────────────────────────────────────────────────────────────────

  /**
   * Sends your message, with any picked files uploaded first. Returns whether it went: when it did not (a file the
   * server refused, a dropped connection), the bubble is replaced by the reason and the caller gives you your words
   * and files back. `wire` is what the server receives when it differs from the bubble (a skill: the bubble says
   * `/work fix the leak`, the server gets the skill and your words).
   */
  async function send(profile: string, text: string, files: PendingFile[] = [], options: { wire?: string } = {}): Promise<boolean> {
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
      const liveId = get(profile).liveId

      if (!liveId) {
        return false
      }

      patchTranscript(profile, transcript => appendUser(transcript, trimmed, now(), files.map(chipOf)))

      try {
        const uploads: Uploaded[] = []

        for (const file of files) {
          uploads.push(await uploadAttachment(deps.client, liveId, file, await (deps.readBase64 as (uri: string) => Promise<string>)(file.uri)))
        }

        await call(deps.client, 'prompt.submit', { session_id: liveId, text: options.wire ?? messageFor(trimmed, uploads) })

        return true
      } catch (error) {
        // A stale live id (the server restarted, or the session was closed): re-attach once and retry. Uploads queued on
        // the old session are gone with it, so they are sent again.
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

  /** The server's reply to a command it does not know (it is the same code as several other refusals, so the words decide). */
  const UNKNOWN_COMMAND = /not a quick\/plugin\/(?:bundle\/)?skill command/i

  /**
   * Runs a slash command in this bot's chat, the way Hermes Desktop does. A built-in (`exec`) goes to the server's own runner
   * (`slash.exec`), which answers with text, or hands over to `command.dispatch` for the few it cannot run itself; if the runner
   * fails, `command.dispatch` is tried. A skill or one of the bot's own commands goes straight to `command.dispatch`, which
   * answers with text to show, or with a message to send as a turn (a skill: the bubble says what you typed, the server gets
   * the skill). A command that rewinds the chat (`/undo`, `/retry`, `/compress`) makes the chat be read again, so it shows what
   * the server now has. `ok` is false when nothing happened and the words should come back to the box; `prefill` is words
   * the server wants put back in the box (`/undo`).
   */
  async function runCommand(profile: string, name: string, arg: string, run: 'exec' | 'dispatch', typed: string, aliasDepth = 0): Promise<{ ok: boolean; prefill?: string }> {
    if (!get(profile).liveId) {
      await open(profile)
    }

    /** Reads the chat again after a command that changed what the server keeps of it. */
    const resync = async () => {
      if (REWRITES_CHAT.has(name)) {
        await open(profile, { silent: true })
      }
    }

    /** What to do with an answer; `fromRunner` says it came from the plain runner (its answer may be bare output). */
    const apply = async (raw: unknown, fromRunner: boolean): Promise<{ ok: boolean; prefill?: string }> => {
      const answer = dispatchOf(raw)

      if (!answer) {
        // The runner answers with plain output: { output, warning? }.
        const plain = (raw ?? {}) as { output?: unknown; warning?: unknown }
        const output = typeof plain.output === 'string' ? plain.output : ''
        const warning = typeof plain.warning === 'string' && plain.warning ? `${plain.warning}\n` : ''

        if (fromRunner) {
          await resync()
          patchTranscript(profile, transcript => appendOutput(transcript, typed, stripAnsi(`${warning}${output}`)))

          return { ok: true }
        }

        patchTranscript(profile, transcript => appendError(transcript, `The server answered /${name} in a way this app does not understand.`))

        return { ok: false }
      }

      if (answer.type === 'exec' || answer.type === 'plugin') {
        await resync()
        patchTranscript(profile, transcript => appendOutput(transcript, typed, stripAnsi(answer.output)))

        return { ok: true }
      }

      if (answer.type === 'alias') {
        const target = parseSlash(`/${answer.target.replace(/^\//, '')}${arg ? ` ${arg}` : ''}`)

        // One hop: an alias that points at another alias is more likely a loop than a plan.
        if (!target || aliasDepth > 0) {
          patchTranscript(profile, transcript => appendError(transcript, `/${name} points at /${answer.target}, which can’t be run from here.`))

          return { ok: false }
        }

        return runCommand(profile, target.name, target.arg, 'dispatch', typed, aliasDepth + 1)
      }

      await resync()

      if (answer.notice) {
        patchTranscript(profile, transcript => appendOutput(transcript, typed, stripAnsi(answer.notice as string)))
      }

      if (answer.type === 'prefill') {
        return { ok: true, prefill: answer.message }
      }

      const message = answer.message.trim()

      if (!message) {
        patchTranscript(profile, transcript => appendError(transcript, `/${name} had nothing to send.`))

        return { ok: false }
      }

      // The bubble shows what you typed, as Hermes Desktop does: the server's own projection, else the invocation read from
      // the expanded skill, else (a short send such as /steer) the message itself.
      const shown = answer.display || skillInvocation(message) || (answer.type === 'skill' ? typed : message)

      return { ok: await send(profile, shown, [], { wire: message }) }
    }

    let runnerError: string | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const liveId = get(profile).liveId

      if (!liveId) {
        return { ok: false }
      }

      try {
        if (run === 'exec' && runnerError === null) {
          // The server's runner can take a while (the first built-in in a chat starts a worker process, which it gives 45 s):
          // show that the command is running until it answers.
          patchTranscript(profile, transcript => startOutput(transcript, typed))

          let answered: unknown

          try {
            answered = await call(deps.client, 'slash.exec', { session_id: liveId, command: `/${name}${arg ? ` ${arg}` : ''}` })
          } catch (error) {
            patchTranscript(profile, finishOutput)

            // A stale chat is dealt with below; any other failure of the runner leaves command.dispatch to try.
            if (isRpcCode(error, RpcCode.StaleSession)) {
              throw error
            }

            runnerError = describeError(error)
          }

          if (runnerError === null) {
            patchTranscript(profile, finishOutput)

            return await apply(answered, true)
          }
        }

        return await apply(await call(deps.client, 'command.dispatch', { session_id: liveId, name, arg }), false)
      } catch (error) {
        if (attempt === 0 && isRpcCode(error, RpcCode.StaleSession)) {
          runnerError = null
          await open(profile, { silent: true })
          continue
        }

        const reason = describeError(error)

        // "Not a command command.dispatch knows" is only routing noise when the runner already said what went wrong.
        const message = stripAnsi(UNKNOWN_COMMAND.test(reason) ? (runnerError ?? `There is no command called /${name}.`) : reason)

        patchTranscript(profile, transcript => appendError(transcript, message))

        return { ok: false }
      }
    }

    return { ok: false }
  }

  /** Shows text in the chat as a command's output (for answers the app gives itself, such as /help). */
  function showOutput(profile: string, command: string, text: string, groups?: { title: string; names: string[] }[]) {
    patchTranscript(profile, transcript => appendOutput(transcript, command, text, groups))
  }

  async function stop(profile: string): Promise<void> {
    const liveId = get(profile).liveId

    if (liveId) {
      await call(deps.client, 'session.interrupt', { session_id: liveId }).catch(() => undefined)
    }
  }

  async function respondApproval(profile: string, requestId: string, choice: 'once' | 'session' | 'always' | 'deny'): Promise<RespondResult> {
    const liveId = get(profile).liveId

    if (!liveId) {
      return 'failed'
    }

    // A newer Hermes asked this as a request: the answer is the response to it.
    const sent = deps.requests?.answer(requestId, { kind: 'approval', choice })

    if (sent === 'sent') {
      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, { choice }))

      return 'answered'
    }

    if (sent === 'failed') {
      return 'failed'
    }

    try {
      const { resolved } = await call(deps.client, 'approval.respond', { session_id: liveId, request_id: requestId, choice })

      // resolved: 0 means it was already answered (another device) or timed out.
      patchTranscript(profile, transcript => (resolved ? answerPrompt(transcript, requestId, { choice }) : expirePrompt(transcript, requestId)))

      return resolved ? 'answered' : 'expired'
    } catch {
      return 'failed'
    }
  }

  /**
   * Sends one answer per question (by `qid`); the tool resumes once every question has one.
   * A multi-select answer is a JSON array string.
   */
  async function respondClarify(profile: string, requestId: string, answers: ClarifyAnswer[]): Promise<RespondResult> {
    const liveId = get(profile).liveId

    if (!liveId || !answers.length) {
      return 'failed'
    }

    const sent = deps.requests?.answer(requestId, { kind: 'clarify', answers })

    if (sent === 'sent') {
      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, { text: answers.map(entry => entry.answer).join(' · ') }))

      return 'answered'
    }

    if (sent === 'failed') {
      return 'failed'
    }

    try {
      for (const { questionId, answer } of answers) {
        const result = await call(deps.client, 'clarify.respond', {
          session_id: liveId,
          request_id: requestId,
          answer,
          ...(questionId ? { question_id: questionId } : {}),
        })

        if (result.status === 'expired') {
          patchTranscript(profile, transcript => expirePrompt(transcript, requestId))

          return 'expired'
        }
      }

      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, { text: answers.map(entry => entry.answer).join(' · ') }))

      return 'answered'
    } catch {
      return 'failed'
    }
  }

  /** The value is sent and forgotten: it is never put in state, logs or storage. */
  async function respondSecret(profile: string, requestId: string, value: string): Promise<RespondResult> {
    const liveId = get(profile).liveId

    if (!liveId) {
      return 'failed'
    }

    const sent = deps.requests?.answer(requestId, { kind: 'value', value })

    if (sent === 'sent') {
      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, {}))

      return 'answered'
    }

    if (sent === 'failed') {
      return 'failed'
    }

    try {
      await call(deps.client, 'secret.respond', { session_id: liveId, request_id: requestId, value })
      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, {}))

      return 'answered'
    } catch {
      return 'failed'
    }
  }

  async function respondSudo(profile: string, requestId: string, password: string): Promise<RespondResult> {
    const liveId = get(profile).liveId

    if (!liveId) {
      return 'failed'
    }

    const sent = deps.requests?.answer(requestId, { kind: 'value', value: password })

    if (sent === 'sent') {
      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, {}))

      return 'answered'
    }

    if (sent === 'failed') {
      return 'failed'
    }

    try {
      await call(deps.client, 'sudo.respond', { session_id: liveId, request_id: requestId, password })
      patchTranscript(profile, transcript => answerPrompt(transcript, requestId, {}))

      return 'answered'
    } catch {
      return 'failed'
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────────────────────────

  /**
   * After a reconnect: re-attach every chat we had open so events route to us and nothing is missed. A chat that failed to
   * open is tried again too: it was most likely opened before the socket was up (the app restored straight into it).
   */
  async function reattachAll(): Promise<void> {
    const profiles = Object.values(store.getState().bots)
      .filter(bot => bot.phase === 'ready' || bot.phase === 'error')
      .map(bot => bot.profile)

    await Promise.all(profiles.map(profile => open(profile, { silent: true })))
  }

  /** Live ids the app knows belong to each bot, for matching `session.active_list` rows. */
  function knownLiveIds(): Record<string, string[]> {
    const byBot: Record<string, string[]> = {}

    for (const [liveId, profile] of liveToProfile) {
      ;(byBot[profile] ??= []).push(liveId)
    }

    return byBot
  }

  function dispose() {
    stopEvents()

    for (const queue of queues.values()) {
      queue.dispose()
    }

    queues.clear()
  }

  return { store, open, openChat, openLinked, newChat, leaveSide, forget, listChats, findInbox, deleteChat, loadOlder, send, runCommand, showOutput, stop, respondApproval, respondClarify, respondSecret, respondSudo, reattachAll, knownLiveIds, refreshJobs, dispose }
}

export type Sessions = ReturnType<typeof createSessions>
