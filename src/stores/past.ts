import { create } from 'zustand'

import { PAGE_SIZE } from '@/features/sessions/store'
import { listSessionMessages, type StoredMessage } from '@/lib/hermes/rest'
import { useConnection } from '@/stores/connection'

export interface PastChat {
  /** Oldest first, as the server returns them. */
  rows: StoredMessage[]
  hasOlder: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
}

interface PastState {
  byId: Record<string, PastChat | undefined>
  load: (profile: string, sessionId: string) => Promise<void>
  loadOlder: (profile: string, sessionId: string) => Promise<void>
}

const failure = (error: unknown) => (error instanceof Error ? error.message : 'Could not read this chat.')

/**
 * A chat of the past, read straight from the server's stored messages. Nothing here opens the chat on the server (no
 * `session.resume`), so it works for any session, including ones the server will not let a phone resume (a Kanban
 * worker's transcript) and ones that are mid-run elsewhere.
 */
export const usePast = create<PastState>((set, get) => ({
  byId: {},
  load: async (profile, sessionId) => {
    const config = useConnection.getState().config

    if (!config) {
      set(state => ({ byId: { ...state.byId, [sessionId]: { rows: [], hasOlder: false, loading: false, loadingOlder: false, error: 'Not connected to the server.' } } }))

      return
    }

    try {
      const page = await listSessionMessages(config, sessionId, profile, { order: 'latest', limit: PAGE_SIZE, includeCompacted: true })

      set(state => ({ byId: { ...state.byId, [sessionId]: { rows: page.messages, hasOlder: page.pagination.returned >= PAGE_SIZE, loading: false, loadingOlder: false, error: null } } }))
    } catch (error) {
      set(state => ({ byId: { ...state.byId, [sessionId]: { rows: [], hasOlder: false, loading: false, loadingOlder: false, error: failure(error) } } }))
    }
  },
  loadOlder: async (profile, sessionId) => {
    const config = useConnection.getState().config
    const past = get().byId[sessionId]

    if (!config || !past || !past.hasOlder || past.loadingOlder) {
      return
    }

    set(state => ({ byId: { ...state.byId, [sessionId]: { ...past, loadingOlder: true } } }))

    try {
      const page = await listSessionMessages(config, sessionId, profile, { order: 'latest', limit: PAGE_SIZE, offset: past.rows.length, includeCompacted: true })

      set(state => ({ byId: { ...state.byId, [sessionId]: { ...past, rows: [...page.messages, ...past.rows], hasOlder: page.pagination.returned >= PAGE_SIZE, loadingOlder: false } } }))
    } catch {
      set(state => ({ byId: { ...state.byId, [sessionId]: { ...past, loadingOlder: false } } }))
    }
  },
}))
