import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { reuseRows } from '@/features/roster/derive'
import { describeError } from '@/lib/hermes/errors'
import { coalesce } from '@/lib/coalesce'
import { startPoller } from '@/lib/poller'
import type { ProfileRow } from '@/lib/hermes/protocol'
import { call } from '@/lib/hermes/rpc'
import { gateway, onGatewayEvent, useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

interface RosterState {
  server: string | null
  rows: ProfileRow[]
  /** At least one roster response (or cached roster for this server) is available. */
  loaded: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  syncServer: (baseUrl: string | null) => void
}

export const useRoster = create<RosterState>()(
  persist(
    (set, get) => ({
      server: null,
      rows: [],
      loaded: false,
      loading: false,
      error: null,

      syncServer: baseUrl => {
        const state = get()

        if (baseUrl !== state.server) {
          set({ server: baseUrl, rows: [], loaded: false, error: null })
        } else if (baseUrl && state.rows.length > 0 && !state.loaded) {
          set({ loaded: true })
        }
      },

      refresh: async () => {
        const baseUrl = useConnection.getState().config?.baseUrl ?? null

        if (get().loading || useConnection.getState().status !== 'online' || !baseUrl) {
          return
        }

        set({ loading: true })

        try {
          const { profiles } = await call(gateway, 'profiles.list', { include_sessions: true })

          // Most reads return the same data: skip the update so nothing re-renders, and keep unchanged rows as the same objects.
          const currentRows = get().server === baseUrl ? get().rows : []
          const rows = reuseRows(currentRows, profiles)

          set({
            server: baseUrl,
            ...(rows ? { rows } : {}),
            loaded: true,
            error: null,
          })
        } catch (error) {
          set({ error: describeError(error) })
        } finally {
          set({ loading: false })
        }
      },
    }),
    {
      name: 'blobs.roster',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ server: state.server, rows: state.rows }),
      onRehydrateStorage: () => state => {
        if (!state) {
          return
        }

        const connection = useConnection.getState()

        if (!connection.hydrated) {
          return
        }

        const baseUrl = connection.config?.baseUrl ?? null

        if (baseUrl && state.server === baseUrl && state.rows.length > 0) {
          useRoster.setState({ loaded: true })
        } else if (state.server !== baseUrl) {
          useRoster.setState({ server: baseUrl, rows: [], loaded: false })
        }
      },
    },
  ),
)

/**
 * Refreshes the roster when the server says sessions changed, at most every 8 s while bots write (the roster is the costly
 * read, ~0.5 s of server time; who is working comes from the inbox's cheap status read, every 3 s), with a safety read every
 * 30 s in the foreground for anything that changes without that signal (a bot's name or look edited elsewhere).
 */
export function startRosterSync(): () => void {
  const refresh = () => void useRoster.getState().refresh()
  const stopPoll = startPoller(refresh, 30_000, () => useConnection.getState().status === 'online')
  const changed = coalesce(refresh, { delayMs: 400, minGapMs: 8_000 })

  const syncServer = () => {
    const connection = useConnection.getState()

    if (connection.hydrated) {
      useRoster.getState().syncServer(connection.config?.baseUrl ?? null)
    }
  }

  syncServer()

  const stopEvents = onGatewayEvent(event => {
    if (event.type === 'sessions.changed') {
      changed.signal()
    }
  })

  // A fresh connection has a fresh roster; switching servers clears the previous server's cached rows.
  const stopConnection = useConnection.subscribe((state, previous) => {
    if (state.hydrated && (state.config?.baseUrl !== previous.config?.baseUrl || !previous.hydrated)) {
      useRoster.getState().syncServer(state.config?.baseUrl ?? null)
    }

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

registerServerReset(baseUrl => useRoster.getState().syncServer(baseUrl))
