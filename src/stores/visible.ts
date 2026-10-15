import { create } from 'zustand'

import { activityStamp, isCurrent, lastVisible, type VisibleActivity } from '@/features/roster/visible'
import { listSessionMessages } from '@/lib/hermes/rest'
import { useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'

interface VisibleState {
  byBot: Record<string, VisibleActivity | undefined>
}

/** What each bot's chat shows you last, read from its stored messages (see features/roster/visible.ts). */
export const useVisible = create<VisibleState>(() => ({ byBot: {} }))

/** How many of a chat's newest messages are read: enough to get past a long exchange between bots. */
const WINDOW = 60

/**
 * Keeps `useVisible` current: whenever a bot's chat has new activity (its roster `last_active` changed), reads that
 * chat's latest messages once. A bot with nothing new costs nothing. Runs one at a time.
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

        for (const row of useRoster.getState().rows) {
          const canonical = row.canonical_session
          const storedId = canonical?.resolved_id || canonical?.id
          const stamp = activityStamp(canonical)

          if (stopped || !storedId || isCurrent(useVisible.getState().byBot[row.name], canonical)) {
            continue
          }

          try {
            const page = await listSessionMessages(config, storedId, row.name, { order: 'latest', limit: WINDOW, includeCompacted: true })
            useVisible.setState(state => ({ byBot: { ...state.byBot, [row.name]: lastVisible(page.messages, stamp) } }))
          } catch {
            // A bot that was read before keeps what it showed. One that never was falls back to the server's own preview.
            useVisible.setState(state => (state.byBot[row.name] ? state : { byBot: { ...state.byBot, [row.name]: { stamp, ts: 0, text: '', failed: true } } }))
          }
        }
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
