import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { describeError } from '@/features/sessions/store'
import {
  answerCall,
  approveErrand,
  cancelErrand,
  declineErrand,
  getErrand,
  getPhoneSettings,
  getPhoneStatus,
  hangUpCall,
  listErrands,
  PhoneRefusal,
  setPhoneSettings,
  type ApproveEdits,
  type Errand,
  type ErrandRow,
  type PhoneSettings,
  type PhoneStatus,
  type SettingsChange,
} from '@/lib/hermes/phone'
import { startPoller } from '@/lib/poller'
import { useConnection } from '@/stores/connection'

/** While a call is being made, the errands are read this often; otherwise every 30 s. */
const LIVE_MS = 5_000
const IDLE_MS = 30_000

interface PhoneState {
  /** Whether the server has hermes-phone: null until known. Without it nothing about calls is shown. */
  available: boolean | null
  status: PhoneStatus | null
  /** The plugin's settings (never-share values are never in them). Null until read. */
  settings: PhoneSettings | null
  /** The newest errands, as the list gives them. */
  rows: ErrandRow[]
  /** Each errand in full, by id. */
  errands: Record<string, Errand>
  /** Finished errands whose "they asked you" you marked done (kept across launches). */
  dismissed: string[]
  refresh: () => Promise<void>
  loadErrand: (id: string) => Promise<string | null>
  loadSettings: () => Promise<string | null>
  /** Each returns an error to show, or null. */
  approve: (id: string, edits: ApproveEdits) => Promise<string | null>
  decline: (id: string) => Promise<string | null>
  cancel: (id: string) => Promise<string | null>
  hangUp: (errandId: string, callId: string) => Promise<string | null>
  answer: (errandId: string, callId: string, text: string) => Promise<string | null>
  saveSettings: (change: SettingsChange) => Promise<string | null>
  dismiss: (id: string) => void
  reset: () => void
}

/** Errands whose state can move without you: read in full on every refresh. */
const moving = (status: string) => status === 'approved' || status === 'running'

/** A refusal said for the person: the plugin's own words, with a hint where a retry won't help. */
function refusalText(error: unknown): string {
  if (error instanceof PhoneRefusal) {
    switch (error.reason) {
      case 'decided':
        return `${error.message} It was decided somewhere else.`
      case 'not_running':
        return `${error.message} The call service on the server isn’t running.`
      default:
        return error.message
    }
  }

  return describeError(error)
}

export const usePhone = create<PhoneState>()(
  persist(
    (set, get) => {
      let busy = false
      const config = () => useConnection.getState().config

      const keep = (errand: Errand) => set(state => ({ errands: { ...state.errands, [errand.id]: errand } }))

      async function act(id: string, run: () => Promise<Errand>): Promise<string | null> {
        if (!config()) {
          return 'Not connected to the server.'
        }

        try {
          keep(await run())
          void get().refresh()

          return null
        } catch (error) {
          // Decided elsewhere, or already over: show what it is now.
          if (error instanceof PhoneRefusal && (error.reason === 'decided' || error.reason === 'late')) {
            void get().loadErrand(id)
          }

          return refusalText(error)
        }
      }

      return {
        available: null,
        status: null,
        settings: null,
        rows: [],
        errands: {},
        dismissed: [],

        refresh: async () => {
          const current = config()

          if (!current || busy) {
            return
          }

          busy = true

          try {
            const status = await getPhoneStatus(current)

            if (!status) {
              set({ available: false, status: null, settings: null, rows: [], errands: {} })

              return
            }

            const rows = await listErrands(current)
            set({ available: true, status, rows })

            if (!get().settings) {
              void get().loadSettings()
            }

            // Read in full what is new, what changed, and what is calling now.
            const known = get().errands
            const stale = rows.filter(row => moving(row.status) || known[row.id]?.status !== row.status || known[row.id]?.calls.length !== row.calls)

            for (const row of stale) {
              try {
                keep(await getErrand(current, row.id))
              } catch {
                // The next refresh tries again.
              }
            }

            // Forget errands the list no longer has (it keeps the newest 50).
            const ids = new Set(rows.map(row => row.id))
            const errands = get().errands

            if (Object.keys(errands).some(id => !ids.has(id))) {
              set({ errands: Object.fromEntries(Object.entries(errands).filter(([id]) => ids.has(id))) })
            }
          } catch {
            // What is shown stays until the next read.
          } finally {
            busy = false
          }
        },

        loadErrand: async id => {
          const current = config()

          if (!current) {
            return 'Not connected to the server.'
          }

          try {
            keep(await getErrand(current, id))

            return null
          } catch (error) {
            return refusalText(error)
          }
        },

        loadSettings: async () => {
          const current = config()

          if (!current) {
            return 'Not connected to the server.'
          }

          try {
            set({ settings: await getPhoneSettings(current) })

            return null
          } catch (error) {
            return refusalText(error)
          }
        },

        approve: (id, edits) => act(id, () => approveErrand(config()!, id, edits)),
        decline: id => act(id, () => declineErrand(config()!, id)),
        cancel: id => act(id, () => cancelErrand(config()!, id)),
        hangUp: (errandId, callId) => act(errandId, () => hangUpCall(config()!, errandId, callId)),
        answer: (errandId, callId, text) => act(errandId, () => answerCall(config()!, errandId, callId, text)),

        saveSettings: async change => {
          const current = config()

          if (!current) {
            return 'Not connected to the server.'
          }

          try {
            set({ settings: await setPhoneSettings(current, change) })
            void get().refresh()

            return null
          } catch (error) {
            return refusalText(error)
          }
        },

        dismiss: id => set(state => ({ dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed.slice(-199), id] })),

        reset: () => set({ available: null, status: null, settings: null, rows: [], errands: {} }),
      }
    },
    { name: 'blobs.phone', storage: createJSONStorage(() => AsyncStorage), partialize: state => ({ dismissed: state.dismissed }) },
  ),
)

/**
 * Keeps phone errands current: every 5 s in the foreground while one is calling, every 30 s otherwise, and at once when the
 * connection comes back. Nothing polls when the server has no hermes-phone, except a check every 30 s in case it is added.
 */
export function startPhoneSync(): () => void {
  let last = 0
  const online = () => useConnection.getState().status === 'online'
  const tick = () => {
    const { rows } = usePhone.getState()
    const due = rows.some(row => moving(row.status)) ? LIVE_MS : IDLE_MS

    if (Date.now() - last >= due - 500) {
      last = Date.now()
      void usePhone.getState().refresh()
    }
  }
  const stopPoll = startPoller(tick, LIVE_MS, online)
  const stopConnection = useConnection.subscribe((state, previous) => {
    // Another server: nothing of the last one's calls applies.
    if (state.config?.baseUrl !== previous.config?.baseUrl) {
      usePhone.getState().reset()
    }

    if (state.status === 'online' && previous.status !== 'online') {
      last = Date.now()
      void usePhone.getState().refresh()
    }
  })

  return () => {
    stopPoll()
    stopConnection()
  }
}

/** Reads now, and keeps reading every 5 s while a screen about calls is open (whatever the errands are doing). */
export function startPhonePoll(): () => void {
  return startPoller(() => void usePhone.getState().refresh(), LIVE_MS, () => useConnection.getState().status === 'online')
}
