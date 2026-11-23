import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { botLastActive } from '@/features/attention/derive'
import type { ProfileRow } from '@/lib/hermes/protocol'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

interface SeenState {
  server: string | null
  /** Active server's newest seen activity (seconds) per bot. Unread means activity newer than this. */
  seenAt: Record<string, number>
  /** Persisted per-server seen marks so switching servers preserves each server's unread state. */
  seenByServer: Record<string, Record<string, number>>
  syncServer: (baseUrl: string | null) => void
  /** First run: mark everything as already seen, so the list does not open covered in unread dots. */
  seed: (rows: ProfileRow[]) => void
  markSeen: (profile: string, activity: number) => void
}

export const useSeen = create<SeenState>()(
  persist(
    (set, get) => ({
      server: null,
      seenAt: {},
      seenByServer: {},

      syncServer: baseUrl => {
        const state = get()

        if (baseUrl && Object.keys(state.seenByServer).length === 0 && Object.keys(state.seenAt).length > 0 && !state.server) {
          // One-time migration from single-server v1.0 `hermesbot.seen`.
          set({
            server: baseUrl,
            seenByServer: { [baseUrl]: state.seenAt },
          })

          return
        }

        if (baseUrl === state.server) {
          return
        }

        if (!baseUrl) {
          set({ server: null, seenAt: {} })

          return
        }

        set({
          server: baseUrl,
          seenAt: state.seenByServer[baseUrl] ?? {},
        })
      },

      seed: rows => {
        const state = get()
        const known = state.seenAt
        const fresh = rows.filter(row => known[row.name] === undefined)

        if (fresh.length) {
          const next = { ...known, ...Object.fromEntries(fresh.map(row => [row.name, botLastActive(row)])) }
          const server = state.server ?? useConnection.getState().config?.baseUrl ?? null

          set({
            server,
            seenAt: next,
            ...(server ? { seenByServer: { ...state.seenByServer, [server]: next } } : {}),
          })
        }
      },

      markSeen: (profile, activity) => {
        const state = get()

        if (activity > (state.seenAt[profile] ?? 0)) {
          const next = { ...state.seenAt, [profile]: activity }
          const server = state.server ?? useConnection.getState().config?.baseUrl ?? null

          set({
            server,
            seenAt: next,
            ...(server ? { seenByServer: { ...state.seenByServer, [server]: next } } : {}),
          })
        }
      },
    }),
    {
      name: 'hermesbot.seen',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({ server: state.server, seenAt: state.seenAt, seenByServer: state.seenByServer }),
      onRehydrateStorage: () => state => {
        const connection = useConnection.getState()

        if (state && connection.hydrated) {
          state.syncServer(connection.config?.baseUrl ?? null)
        }
      },
    },
  ),
)

registerServerReset(baseUrl => useSeen.getState().syncServer(baseUrl))
