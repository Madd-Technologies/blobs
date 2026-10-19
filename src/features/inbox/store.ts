/**
 * Polls what is going on across all bots: `session.active_list` for status, the open requests of sessions
 * that are working or waiting but not open in the app (their approval prompts were never sent to this
 * connection), and `delegation.status` for helpers still running after their bot's turn.
 * Framework-free with injected dependencies; the app wires the real one.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

import type { ActiveSessionRow, ApprovalChoice, ApprovalRequestPayload, DelegationStatusRow } from '../../lib/hermes/protocol.ts'
import { call, type RpcClient } from '../../lib/hermes/rpc.ts'

export interface InboxState {
  active: ActiveSessionRow[]
  /** Open approvals for sessions this app has not opened, by live id. Sensitive: memory only. */
  polled: Record<string, ApprovalRequestPayload[]>
  /** Every helper running on the server (`delegation.status`), each with the chat whose bot sent it off. */
  background: DelegationStatusRow[]
  loadedAt: number | null
  error: string | null
}

export interface InboxDeps {
  client: RpcClient
  /** Live ids of chats the app has open, which already hear their own prompts. */
  openLiveIds: () => ReadonlySet<string>
  /** The server lists running helpers (Hermes 0.21.5+). Absent or false, none are asked for. */
  liveHelpers?: () => boolean
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
  const store: StoreApi<InboxState> = createStore<InboxState>(() => ({ active: [], polled: {}, background: [], loadedAt: null, error: null }))
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
      // session that is asking a question, a sudo or a secret answers with an empty list.
      const candidates = sessions.filter(row => (row.status === 'working' || row.status === 'waiting') && !open.has(row.id))

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

      return { polled }
    })

    return resolved > 0
  }

  return { store, refresh, respondApproval }
}

export type Inbox = ReturnType<typeof createInbox>
