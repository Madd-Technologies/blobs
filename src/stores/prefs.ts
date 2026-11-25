import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { CallMode } from '@/features/call/engine'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

export type ThemePref = 'system' | 'dark' | 'light'

interface ServerPrefsSlice {
  muted: string[]
  reopenLast: Record<string, boolean>
  lastChats: Record<string, string>
}

const EMPTY_SLICE: ServerPrefsSlice = { muted: [], reopenLast: {}, lastChats: {} }

interface PrefsState {
  theme: ThemePref
  showThinking: boolean
  /** Show what bots say to each other in the person's chats (off: it is left out). */
  showBotChatter: boolean
  /** Current active server URL these bot prefs belong to. */
  server: string | null
  /** Bot profiles the user has muted (no badges/notifications) on the active server. */
  muted: string[]
  /** Bots that open on the side chat they were last on, instead of their main chat: profile -> true. */
  reopenLast: Record<string, boolean>
  /** For those bots: the side chat each was last on (profile -> stored id), kept across launches. */
  lastChats: Record<string, string>
  /** Per-server stored copies of muted / reopenLast / lastChats. */
  byServer: Record<string, ServerPrefsSlice>
  /** The tutorial has been seen (or skipped), so it no longer opens on its own before Connect. Settings can replay it. */
  tourSeen: boolean
  /** How you talk on a voice call: push to talk (the line is open only while it is used) or an open line. */
  callMode: CallMode
  setTheme: (theme: ThemePref) => void
  setShowThinking: (on: boolean) => void
  setShowBotChatter: (on: boolean) => void
  toggleMuted: (profile: string) => void
  setReopenLast: (profile: string, on: boolean) => void
  setLastChats: (lastChats: Record<string, string>) => void
  syncServer: (baseUrl: string | null) => void
  setTourSeen: () => void
  setCallMode: (mode: CallMode) => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      showThinking: false,
      showBotChatter: false,
      server: null,
      muted: [],
      reopenLast: {},
      lastChats: {},
      byServer: {},
      tourSeen: false,
      callMode: 'walkie',
      setTheme: theme => set({ theme }),
      setShowThinking: showThinking => set({ showThinking }),
      setShowBotChatter: showBotChatter => set({ showBotChatter }),
      syncServer: baseUrl => {
        const state = get()

        if (
          baseUrl &&
          !state.server &&
          Object.keys(state.byServer).length === 0 &&
          (state.muted.length > 0 || Object.keys(state.reopenLast).length > 0 || Object.keys(state.lastChats).length > 0)
        ) {
          set({
            server: baseUrl,
            byServer: { [baseUrl]: { muted: state.muted, reopenLast: state.reopenLast, lastChats: state.lastChats } },
          })

          return
        }

        if (baseUrl === state.server) {
          return
        }

        if (!baseUrl) {
          set({ server: null, ...EMPTY_SLICE })

          return
        }

        const slice = state.byServer[baseUrl] ?? EMPTY_SLICE
        set({ server: baseUrl, ...slice })
      },
      setReopenLast: (profile, on) =>
        set(s => {
          const { [profile]: _was, ...reopenLast } = s.reopenLast
          const { [profile]: _last, ...lastChats } = s.lastChats
          const nextReopen = on ? { ...reopenLast, [profile]: true } : reopenLast
          const nextChats = on ? s.lastChats : lastChats
          const server = s.server ?? useConnection.getState().config?.baseUrl ?? null

          return {
            server,
            reopenLast: nextReopen,
            lastChats: nextChats,
            ...(server ? { byServer: { ...s.byServer, [server]: { muted: s.muted, reopenLast: nextReopen, lastChats: nextChats } } } : {}),
          }
        }),
      setLastChats: lastChats =>
        set(s => {
          const server = s.server ?? useConnection.getState().config?.baseUrl ?? null

          return {
            server,
            lastChats,
            ...(server ? { byServer: { ...s.byServer, [server]: { muted: s.muted, reopenLast: s.reopenLast, lastChats } } } : {}),
          }
        }),
      setTourSeen: () => set({ tourSeen: true }),
      setCallMode: callMode => set({ callMode }),
      toggleMuted: profile =>
        set(s => {
          const muted = s.muted.includes(profile) ? s.muted.filter(p => p !== profile) : [...s.muted, profile]
          const server = s.server ?? useConnection.getState().config?.baseUrl ?? null

          return {
            server,
            muted,
            ...(server ? { byServer: { ...s.byServer, [server]: { muted, reopenLast: s.reopenLast, lastChats: s.lastChats } } } : {}),
          }
        }),
    }),
    {
      name: 'hermesbot.prefs',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => state => {
        const connection = useConnection.getState()

        if (state && connection.hydrated) {
          state.syncServer(connection.config?.baseUrl ?? null)
        }
      },
    },
  ),
)

registerServerReset(baseUrl => usePrefs.getState().syncServer(baseUrl))

/** How long the first frame waits for saved preferences: a failed read never reports finishing, and the app must still open. */
const HYDRATE_CAP_MS = 2000

/** Resolves once the saved preferences are loaded (at once if they already are), or after a short cap if they never load. */
export function prefsHydrated(): Promise<void> {
  if (usePrefs.persist.hasHydrated()) {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    const timer = setTimeout(resolve, HYDRATE_CAP_MS)
    usePrefs.persist.onFinishHydration(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
