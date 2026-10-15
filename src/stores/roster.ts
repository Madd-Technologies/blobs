import { create } from 'zustand'

import { describeError } from '@/features/sessions/store'
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

      // Polling returns the same data most of the time: skip the update so nothing re-renders.
      if (JSON.stringify(profiles) !== JSON.stringify(get().rows)) {
        set({ rows: profiles })
      }

      set({ loaded: true, error: null })
    } catch (error) {
      set({ error: describeError(error) })
    } finally {
      set({ loading: false })
    }
  },
}))

/** Polls the roster every 5 s in the foreground, and refreshes when the server says sessions changed. */
export function startRosterSync(): () => void {
  const refresh = () => void useRoster.getState().refresh()
  const stopPoll = startPoller(refresh, 5_000, () => useConnection.getState().status === 'online')
  let debounce: ReturnType<typeof setTimeout> | null = null

  const stopEvents = onGatewayEvent(event => {
    if (event.type === 'sessions.changed' && !debounce) {
      debounce = setTimeout(() => {
        debounce = null
        refresh()
      }, 400)
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

    if (debounce) {
      clearTimeout(debounce)
    }
  }
}
