import { AppState } from 'react-native'
import { create } from 'zustand'

import { busyRows, cameBack, clockLabel, underWay, type RestartChoice, type RestartPhase } from '@/features/restart/model'
import { displayName } from '@/lib/hermes/identity'
import { cancelRestart, getRestartStatus, RestartRefused, requestRestart, restartGateway, type RestartStatus } from '@/lib/hermes/restart'
import { useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'
import { toast } from '@/stores/toast'

/** How often the status is read while it matters: the sheet is open, a restart waits, or one is under way. */
const POLL_MS = 3_000

interface RestartState {
  /** undefined until read; null when the server's hermes-bot-mobile has no restart route. */
  status: RestartStatus | null | undefined
  phase: RestartPhase
  sheet: { open: boolean; choice: RestartChoice | null }
  /** The restarting screen was closed with its back button; the row still says it is restarting. */
  overlayHidden: boolean
  /** A request in flight. */
  sending: boolean
  /** The plugin's words for the last refused request. */
  refused: string | null
  /** Epoch seconds before which another restart is refused (one a minute). */
  retryUntil: number
  /** A timed-out request already seen, which stops the row reading as amber. */
  dismissedTimeout: string | null
  refresh: () => Promise<void>
  open: (choice?: RestartChoice | null) => void
  close: () => void
  choose: (choice: RestartChoice) => void
  restart: (choice: RestartChoice, when: 'now' | 'idle') => Promise<void>
  cancel: () => Promise<void>
  hideOverlay: () => void
}

/** The display name of a bot by profile, as Home shows it. */
export function botName(profile: string | null): string {
  if (!profile) {
    return 'A bot'
  }

  const row = useRoster.getState().rows.find(entry => entry.name === profile)

  return row ? displayName(row, row.ui_meta?.['hermes-bots']) : profile
}

const nowS = () => Date.now() / 1000

export const useRestart = create<RestartState>((set, get) => ({
  status: undefined,
  phase: { kind: 'idle' },
  sheet: { open: false, choice: null },
  overlayHidden: false,
  sending: false,
  refused: null,
  retryUntil: 0,
  dismissedTimeout: null,

  async refresh() {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      const status = await getRestartStatus(config)
      const { phase } = get()
      const going = underWay(status)

      if (phase.kind === 'restarting' && cameBack(status, phase.before)) {
        // A new dashboard process answers: it is back.
        set({ status, phase: { kind: 'idle' }, overlayHidden: false })
        toast(`Hermes is back · restarted ${clockLabel(status?.started_at ?? nowS())}`)

        return
      }

      if (phase.kind === 'restarting' && status?.last && !going && ['failed', 'not_restarted', 'cancelled'].includes(status.last.outcome)) {
        // The same process answers and says the restart did not happen: the row says so.
        set({ status, phase: { kind: 'idle' }, overlayHidden: false })

        return
      }

      if (phase.kind === 'idle' && going && going.outcome !== 'waiting') {
        // A wait ended and the restart began (here or from another phone): carry it through.
        set({ status, phase: { kind: 'restarting', before: status?.started_at ?? null, since: nowS(), choice: going.include_gateway ? 'both' : 'dashboard', waited: [] }, sheet: { open: false, choice: null } })

        return
      }

      set({ status, retryUntil: status?.retry_after ? nowS() + status.retry_after : get().retryUntil })
    } catch {
      // Offline or restarting: keep what was known.
    }
  },

  open(choice = null) {
    const { status } = get()
    const timedOut = status?.last?.outcome === 'timed_out' ? status.last.id : null
    set({ sheet: { open: true, choice }, refused: null, dismissedTimeout: timedOut ?? get().dismissedTimeout })
    void get().refresh()
  },

  close() {
    set({ sheet: { open: false, choice: get().sheet.choice } })
  },

  choose(choice) {
    set({ sheet: { ...get().sheet, choice } })
  },

  async restart(choice, when) {
    const config = useConnection.getState().config
    const { status } = get()

    if (!config || get().sending) {
      return
    }

    set({ sending: true, refused: null })

    try {
      if (choice === 'gateway') {
        await restartGateway(config)
        set({ sheet: { open: false, choice: null } })
        toast('The gateway is restarting · messaging and routines are back in a minute')

        return
      }

      await requestRestart(config, { when, include_gateway: choice === 'both' })

      if (when === 'now') {
        // The names of the chats that were waited for, for the restarting screen.
        const waited = busyRows(status?.busy, botName).map(row => row.name)
        set({ phase: { kind: 'restarting', before: status?.started_at ?? null, since: nowS(), choice, waited: underWay(status)?.outcome === 'waiting' ? waited : [] }, sheet: { open: false, choice: null }, overlayHidden: false })
      }

      await get().refresh()
    } catch (error) {
      if (error instanceof RestartRefused) {
        set({ refused: error.status === 429 ? null : error.message, retryUntil: error.retryAfter ? nowS() + error.retryAfter : get().retryUntil })
      } else {
        set({ refused: error instanceof Error ? error.message : 'Could not ask the server.' })
      }
    } finally {
      set({ sending: false })
    }
  },

  async cancel() {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      await cancelRestart(config)
      toast('Restart cancelled')
      set({ sheet: { open: false, choice: null } })
    } catch (error) {
      set({ refused: error instanceof Error ? error.message : 'Could not cancel it.' })
    }

    await get().refresh()
  },

  hideOverlay() {
    set({ overlayHidden: true })
  },
}))

/** Reads the restart status when the app connects, and every few seconds while a restart matters. */
export function startRestartSync(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  const busy = () => {
    const { sheet, status, phase } = useRestart.getState()

    return sheet.open || phase.kind === 'restarting' || !!underWay(status)
  }
  const tick = () => {
    if (busy() && useConnection.getState().status === 'online' && AppState.currentState === 'active') {
      void useRestart.getState().refresh()
    }
  }
  const ensureTimer = () => {
    if (busy() && !timer) {
      timer = setInterval(tick, POLL_MS)
    } else if (!busy() && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  if (useConnection.getState().status === 'online') {
    void useRestart.getState().refresh()
  }

  const stopConnection = useConnection.subscribe((state, previous) => {
    if (!state.config && previous.config) {
      useRestart.setState({ status: undefined, phase: { kind: 'idle' }, sheet: { open: false, choice: null } })
    } else if (state.status === 'online' && previous.status !== 'online') {
      // Connected, or back from a restart: one read says which.
      void useRestart.getState().refresh()
    }
  })
  const stopStore = useRestart.subscribe(ensureTimer)

  return () => {
    stopConnection()
    stopStore()

    if (timer) {
      clearInterval(timer)
    }
  }
}
