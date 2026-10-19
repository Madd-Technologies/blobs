import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { activityStamp, isCurrent, lastVisible, type VisibleActivity } from '@/features/roster/visible'
import { listSessionMessages } from '@/lib/hermes/rest'
import { useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'

interface VisibleState {
  /** The server these were read from, so another server's previews are never shown. */
  server: string | null
  byBot: Record<string, VisibleActivity | undefined>
}

/** How much of a preview is kept on the phone: the row shows one line. */
const KEPT_CHARS = 240

/**
 * What each bot's chat shows you last, read from its stored messages (see features/roster/visible.ts). Kept on the phone
 * between launches, so Home shows every bot's last line at once on a cold start and only refreshes the ones that changed.
 */
export const useVisible = create<VisibleState>()(
  persist((): VisibleState => ({ server: null, byBot: {} }), {
    name: 'blobs.visible',
    storage: createJSONStorage(() => AsyncStorage),
    partialize: state => ({
      server: state.server,
      byBot: Object.fromEntries(Object.entries(state.byBot).flatMap(([bot, entry]) => (entry && !entry.failed ? [[bot, { ...entry, text: entry.text.slice(0, KEPT_CHARS) }]] : []))),
    }),
  }),
)

/** How many of a chat's newest messages are read: enough to get past a long exchange between bots. */
const WINDOW = 60
/** Chats read at once: in parallel, without crowding out what you open yourself. */
const AT_ONCE = 3

/**
 * Keeps `useVisible` current: whenever a bot's chat has new activity (its roster `last_active` changed), reads that
 * chat's latest messages once. A bot with nothing new costs nothing. One run at a time, a few chats at once.
 */
export function startVisibleSync(): () => void {
  let busy = false
  let again = false
  let stopped = false

  async function run() {
    if (busy) {
      again = true

      return
    }

    busy = true

    try {
      do {
        again = false
        const config = useConnection.getState().config

        if (!config || useConnection.getState().status !== 'online') {
          break
        }

        // Previews kept from another server are not this one's.
        if (useVisible.getState().server !== config.baseUrl) {
          useVisible.setState({ server: config.baseUrl, byBot: {} })
        }

        const todo = useRoster.getState().rows.filter(row => {
          const canonical = row.canonical_session

          return !!(canonical?.resolved_id || canonical?.id) && !isCurrent(useVisible.getState().byBot[row.name], canonical)
        })

        // A few at a time rather than one after another: with many bots the last one used to wait for all the others.
        const next = () => todo.shift()
        const worker = async () => {
          for (let row = next(); row && !stopped; row = next()) {
            const canonical = row.canonical_session
            const storedId = (canonical?.resolved_id || canonical?.id) as string
            const stamp = activityStamp(canonical)
            const name = row.name

            try {
              // Live messages first: the compacted read can fall back to scanning the whole chat on the server. Only a chat
              // compacted since its last visible line has none of its own yet, and needs the compacted ones.
              const read = (includeCompacted: boolean) => listSessionMessages(config, storedId, name, { order: 'latest', limit: WINDOW, includeCompacted })
              let visible = lastVisible((await read(false)).messages, stamp)

              if (!visible.text) {
                visible = lastVisible((await read(true)).messages, stamp)
              }

              useVisible.setState(state => ({ byBot: { ...state.byBot, [name]: visible } }))
            } catch {
              // A bot that was read before keeps what it showed. One that never was falls back to the server's own preview.
              useVisible.setState(state => (state.byBot[name] ? state : { byBot: { ...state.byBot, [name]: { stamp, ts: 0, text: '', failed: true } } }))
            }
          }
        }

        await Promise.all(Array.from({ length: AT_ONCE }, worker))
      } while (again && !stopped)
    } finally {
      busy = false
    }
  }

  const stopRoster = useRoster.subscribe((state, previous) => {
    if (state.rows !== previous.rows) {
      void run()
    }
  })
  const stopConnection = useConnection.subscribe((state, previous) => {
    // Signing out forgets what this phone kept of the server's chats.
    if (!state.config && previous.config) {
      useVisible.setState({ server: null, byBot: {} })
    }

    if (state.status === 'online' && previous.status !== 'online') {
      void run()
    }
  })

  void run()

  return () => {
    stopped = true
    stopRoster()
    stopConnection()
  }
}
