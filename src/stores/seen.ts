import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { botLastActive } from '@/features/attention/derive'
import type { ProfileRow } from '@/lib/hermes/protocol'

interface SeenState {
  /** Per bot: the newest activity (seconds) the user has seen. Unread means activity newer than this. */
  seenAt: Record<string, number>
  /** First run: mark everything as already seen, so the list does not open covered in unread dots. */
  seed: (rows: ProfileRow[]) => void
  markSeen: (profile: string, activity: number) => void
}

export const useSeen = create<SeenState>()(
  persist(
    (set, get) => ({
      seenAt: {},

      seed: rows => {
        const known = get().seenAt
        const fresh = rows.filter(row => known[row.name] === undefined)

        if (fresh.length) {
          set({ seenAt: { ...known, ...Object.fromEntries(fresh.map(row => [row.name, botLastActive(row)])) } })
        }
      },

      markSeen: (profile, activity) => {
        if (activity > (get().seenAt[profile] ?? 0)) {
          set(state => ({ seenAt: { ...state.seenAt, [profile]: activity } }))
        }
      },
    }),
    { name: 'hermesbot.seen', storage: createJSONStorage(() => AsyncStorage), partialize: state => ({ seenAt: state.seenAt }) },
  ),
)
