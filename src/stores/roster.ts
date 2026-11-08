import { create } from 'zustand'

import { reuseRows } from '@/features/roster/derive'
import { describeError } from '@/features/sessions/store'
import { coalesce } from '@/lib/coalesce'
import { startPoller } from '@/lib/poller'
import type { ProfileRow } from '@/lib/hermes/protocol'
import { call } from '@/lib/hermes/rpc'
import { gateway, onGatewayEvent, useConnection } from '@/stores/connection'

interface RosterState {
  rows: ProfileRow[]
  /** At least one roster response has arrived. */
  loaded: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export const useRoster = create<RosterState>((set, get) => ({
  rows: [],
  loaded: false,
  loading: false,
  error: null,

  refresh: async () => {
    if (get().loading || useConnection.getState().status !== 'online') {
      return
    }

    set({ loading: true })

    try {
      const { profiles } = await call(gateway, 'profiles.list', { include_sessions: true })

      // Most reads return the same data: skip the update so nothing re-renders, and keep unchanged rows as the same objects.
      const rows = reuseRows(get().rows, profiles)

      if (rows) {
        set({ rows })
      }

      set({ loaded: true, error: null })
    } catch (error) {
      set({ error: describeError(error) })
    } finally {
      set({ loading: false })
    }
  },
}))

/**
 * Refreshes the roster when the server says sessions changed, at most every 8 s while bots write (the roster is the costly
 * read, ~0.5 s of server time; who is working comes from the inbox's cheap status read, every 3 s), with a safety read every
 * 30 s in the foreground for anything that changes without that signal (a bot's name or look edited elsewhere).
 */
export function startRosterSync(): () => void {
  const refresh = () => void useRoster.getState().refresh()
  const stopPoll = startPoller(refresh, 30_000, () => useConnection.getState().status === 'online')
  const changed = coalesce(refresh, { delayMs: 400, minGapMs: 8_000 })

  const stopEvents = onGatewayEvent(event => {
    if (event.type === 'sessions.changed') {
      changed.signal()
    }
  })

  // A fresh connection has a fresh roster.
  const stopConnection = useConnection.subscribe((state, previous) => {
    if (state.status === 'online' && previous.status !== 'online') {
      refresh()
    }
  })

  return () => {
    stopPoll()
    stopEvents()
    stopConnection()
    changed.cancel()
  }
}
