/**
 * Polls what is going on across all bots: `session.active_list` for status, and `approval.pending`
 * for sessions that are working or waiting but not open in the app (their approval prompts were never
 * sent to this connection). Framework-free with injected dependencies; the app wires the real one.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

import type { ActiveSessionRow, ApprovalChoice, ApprovalRequestPayload } from '../../lib/hermes/protocol.ts'
import { call, type RpcClient } from '../../lib/hermes/rpc.ts'

export interface InboxState {
  active: ActiveSessionRow[]
  /** Open approvals for sessions this app has not opened, by live id. Sensitive: memory only. */
  polled: Record<string, ApprovalRequestPayload[]>
  loadedAt: number | null
  error: string | null
}

export interface InboxDeps {
  client: RpcClient
  /** Live ids of chats the app has open, which already hear their own prompts. */
  openLiveIds: () => ReadonlySet<string>
  now?: () => number
}

/** `approval.pending` can block for up to 30 s on a busy session; do not hold a refresh that long. */
const PENDING_TIMEOUT_MS = 8_000

export function createInbox(deps: InboxDeps) {
  const now = deps.now ?? Date.now
  const store: StoreApi<InboxState> = createStore<InboxState>(() => ({ active: [], polled: {}, loadedAt: null, error: null }))
  let refreshing: Promise<void> | null = null

  async function doRefresh() {
    try {
      const { sessions } = await call(deps.client, 'session.active_list', {})
      const open = deps.openLiveIds()
      // A session holding an approval reads `working` on older servers and `waiting` on 0.21.6, so ask both. A `waiting`
      // session that is asking a question, a sudo or a secret answers with an empty list.
      const candidates = sessions.filter(row => (row.status === 'working' || row.status === 'waiting') && !open.has(row.id))

      const results = await Promise.allSettled(
        candidates.map(async row => ({ id: row.id, approvals: (await call(deps.client, 'approval.pending', { session_id: row.id }, { timeoutMs: PENDING_TIMEOUT_MS })).approvals })),
      )

      const polled: Record<string, ApprovalRequestPayload[]> = {}

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.approvals.length) {
          polled[result.value.id] = result.value.approvals
        }
      }

      store.setState({ active: sessions, polled, loadedAt: now(), error: null })
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
