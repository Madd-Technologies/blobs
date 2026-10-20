/**
 * What is going on across all bots: `session.active_list` for status and `delegation.status` for helpers still running
 * after their bot's turn, polled; and what waits on the person, pushed by the server (hermes-bot-mobile 0.1.7+, see
 * `pushed.ts`). On a server that does not push it, the open requests of sessions that are working or waiting but not
 * open in the app (their prompts were never sent to this connection) are polled instead.
 * Framework-free with injected dependencies; the app wires the real one.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

import type { ActiveSessionRow, ApprovalChoice, ApprovalRequestPayload, DelegationStatusRow } from '../../lib/hermes/protocol.ts'
import { call, type RpcClient } from '../../lib/hermes/rpc.ts'
import { parseKanban, parseNeedsYou, type KanbanApproval, type PushedRequest } from './pushed.ts'

export interface InboxState {
  active: ActiveSessionRow[]
  /** Open approvals for sessions this app has not opened, by live id. Sensitive: memory only. */
  polled: Record<string, ApprovalRequestPayload[]>
  /** Every helper running on the server (`delegation.status`), each with the chat whose bot sent it off. */
  background: DelegationStatusRow[]
  /** What the server pushes as waiting on you, or null when it does not push it. Sensitive: memory only. */
  pushed: PushedRequest[] | null
  /** Approvals kanban workers wait on (hermes-bot-mobile 0.1.9+), pushed with the rest. Sensitive: memory only. */
  kanban: KanbanApproval[]
  loadedAt: number | null
  error: string | null
}

export interface InboxDeps {
  client: RpcClient
  /** Live ids of chats the app has open, which already hear their own prompts. */
  openLiveIds: () => ReadonlySet<string>
  /** The server lists running helpers (Hermes 0.21.5+). Absent or false, none are asked for. */
  liveHelpers?: () => boolean
  /** Reads `GET …/hermes-bot-mobile/needs-you`; null when the server has no such route. Absent, nothing is pushed. */
  readNeedsYou?: () => Promise<unknown>
  /** Answers a kanban worker's approval through the plugin: `expired` when it no longer waits (or was answered already). */
  answerKanban?: (id: string, choice: ApprovalChoice) => Promise<'answered' | 'expired'>
  now?: () => number
}

/** A session's open requests are read in memory and answer at once; a slow reply is not worth holding the poll for. */
const PENDING_TIMEOUT_MS = 5_000

/**
 * The approvals among a session's open requests (`session.events.since` → `open_requests`, Hermes 0.21.5): the server
 * request's params are the approval as sent (`tui_gateway/contracts/server_requests.py` ApprovalRequestParams, command
 * already redacted).
 */
export function approvalsFrom(open: unknown): ApprovalRequestPayload[] {
  if (!Array.isArray(open)) {
    return []
  }

  return open.flatMap(entry => {
    const frame = entry && typeof entry === 'object' ? (entry as { id?: unknown; method?: unknown; params?: Record<string, unknown> }) : null
    const params = frame?.params ?? {}

    if (frame?.method !== 'approval' || (typeof params.request_id !== 'string' && typeof frame.id !== 'string')) {
      return []
    }

    return [
      {
        request_id: typeof params.request_id === 'string' && params.request_id ? params.request_id : String(frame.id),
        command: typeof params.command === 'string' ? params.command : '',
        description: typeof params.description === 'string' ? params.description : '',
        ...(Array.isArray(params.choices) ? { choices: params.choices as ApprovalRequestPayload['choices'] } : {}),
        ...(typeof params.allow_session === 'boolean' ? { allow_session: params.allow_session } : {}),
        ...(typeof params.allow_permanent === 'boolean' ? { allow_permanent: params.allow_permanent } : {}),
      },
    ]
  })
}

export function createInbox(deps: InboxDeps) {
  const now = deps.now ?? Date.now
  const store: StoreApi<InboxState> = createStore<InboxState>(() => ({ active: [], polled: {}, background: [], pushed: null, kanban: [], loadedAt: null, error: null }))
  let refreshing: Promise<void> | null = null

  async function doRefresh() {
    try {
      const [{ sessions }, background] = await Promise.all([
        call(deps.client, 'session.active_list', {}),
        // A failed read shows no helpers rather than failing the whole poll.
        deps.liveHelpers?.() ? call(deps.client, 'delegation.status', {}).then(result => result.active ?? [], () => [] as DelegationStatusRow[]) : ([] as DelegationStatusRow[]),
      ])
      const open = deps.openLiveIds()
      // A session holding an approval reads `working` on older servers and `waiting` on 0.21.6, so ask both. A `waiting`
      // session that is asking a question, a sudo or a secret answers with an empty list. A server that pushes what waits
      // on you is never asked.
      const candidates = store.getState().pushed ? [] : sessions.filter(row => (row.status === 'working' || row.status === 'waiting') && !open.has(row.id))

      // Each session's open requests, not `approval.pending`: that runs on the socket's own reader (not the server's worker
      // pool) and waits up to 30 s for a cold agent to build, holding every later request on the connection behind it.
      // The open requests are read from memory and include the approval as it was sent.
      const results = await Promise.allSettled(
        candidates.map(async row => {
          const { open_requests: open } = await call(deps.client, 'session.events.since', { session_id: row.id, last_seen: Number.MAX_SAFE_INTEGER }, { timeoutMs: PENDING_TIMEOUT_MS })

          return { id: row.id, approvals: approvalsFrom(open) }
        }),
      )

      const polled: Record<string, ApprovalRequestPayload[]> = {}

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.approvals.length) {
          polled[result.value.id] = result.value.approvals
        }
      }

      store.setState({ active: sessions, polled, background, loadedAt: now(), error: null })
    } catch (error) {
      // Keep the last good picture; just note that it is stale.
      store.setState({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Reads what waits on you from the server, when it connects or comes back to the front (pushed events are not replayed
   * after a reconnect). A server without the route, or one that cannot push, leaves the app on its own check.
   */
  async function loadPushed(): Promise<void> {
    if (!deps.readNeedsYou) {
      return
    }

    try {
      const body = await deps.readNeedsYou()
      const pushed = parseNeedsYou(body)
      const before = store.getState().pushed
      store.setState({ pushed, kanban: pushed ? parseKanban(body) : [] })

      if (before && !pushed) {
        // The server stopped pushing (the plugin was removed or disabled): check the busy chats again at once.
        void refresh()
      }
    } catch {
      // A failed read keeps the last list: the next event or connection brings a fresh one.
    }
  }

  /** The server's `plugin.hermes-bot-mobile.needs_you.changed`: the whole list, as it is now. */
  function applyPushed(payload: unknown) {
    const pushed = parseNeedsYou(payload)

    if (pushed) {
      store.setState({ pushed, kanban: parseKanban(payload) })
    }
  }

  /**
   * Answers a kanban worker's approval. It leaves the list at once; one that no longer waits leaves it too. Throws when the
   * answer could not be sent (it stays, to try again).
   */
  async function answerKanban(id: string, choice: ApprovalChoice): Promise<'answered' | 'expired'> {
    if (!deps.answerKanban) {
      return 'expired'
    }

    const outcome = await deps.answerKanban(id, choice)
    store.setState(state => ({ kanban: state.kanban.filter(approval => approval.id !== id) }))

    return outcome
  }

  /** Takes an answered prompt off the pushed list at once, before the server's next push confirms it. */
  function dropPushed(frameId: string) {
    store.setState(state => (state.pushed ? { pushed: state.pushed.filter(request => request.id !== frameId) } : state))
  }

  /** Refreshes now; concurrent calls share one run. */
  function refresh(): Promise<void> {
    refreshing ??= doRefresh().finally(() => {
      refreshing = null
    })

    return refreshing
  }

  /** Answers an approval on a session the app has not opened. Returns false if it was already resolved. */
  async function respondApproval(liveId: string, requestId: string, choice: ApprovalChoice): Promise<boolean> {
    const { resolved } = await call(deps.client, 'approval.respond', { session_id: liveId, request_id: requestId, choice })

    store.setState(state => {
      const rest = (state.polled[liveId] ?? []).filter(row => row.request_id !== requestId)
      const polled = { ...state.polled }

      if (rest.length) {
        polled[liveId] = rest
      } else {
        delete polled[liveId]
      }

      return { polled, pushed: state.pushed?.filter(row => row.sessionId !== liveId || row.method !== 'approval' || row.params.request_id !== requestId) ?? null }
    })

    return resolved > 0
  }

  return { store, refresh, respondApproval, loadPushed, applyPushed, dropPushed, answerKanban }
}

export type Inbox = ReturnType<typeof createInbox>
