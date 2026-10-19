import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemePref = 'system' | 'dark' | 'light'

interface PrefsState {
  theme: ThemePref
  showThinking: boolean
  /** Show what bots say to each other in the person's chats (off: it is left out). */
  showBotChatter: boolean
  /** Bot profiles the user has muted (no badges/notifications). */
  muted: string[]
  /** Bots that open on the side chat they were last on, instead of their main chat (the default): profile -> true. */
  reopenLast: Record<string, boolean>
  /** For those bots: the side chat each was last on (profile -> stored id), kept across launches. */
  lastChats: Record<string, string>
  /** The tutorial has been seen (or skipped), so it no longer opens on its own before Connect. Settings can replay it. */
  tourSeen: boolean
  setTheme: (theme: ThemePref) => void
  setShowThinking: (on: boolean) => void
  setShowBotChatter: (on: boolean) => void
  toggleMuted: (profile: string) => void
  setReopenLast: (profile: string, on: boolean) => void
  setTourSeen: () => void
}

export const usePrefs = create<PrefsState>()(
  persist(
    set => ({
      theme: 'system',
      showThinking: false,
      showBotChatter: false,
      muted: [],
      reopenLast: {},
      lastChats: {},
      tourSeen: false,
      setTheme: theme => set({ theme }),
      setShowThinking: showThinking => set({ showThinking }),
      setShowBotChatter: showBotChatter => set({ showBotChatter }),
      setReopenLast: (profile, on) =>
        set(s => {
          const { [profile]: _was, ...reopenLast } = s.reopenLast
          const { [profile]: _last, ...lastChats } = s.lastChats

          return on ? { reopenLast: { ...reopenLast, [profile]: true } } : { reopenLast, lastChats }
        }),
      setTourSeen: () => set({ tourSeen: true }),
      toggleMuted: profile =>
        set(s => ({
          muted: s.muted.includes(profile) ? s.muted.filter(p => p !== profile) : [...s.muted, profile],
        })),
    }),
    { name: 'hermesbot.prefs', storage: createJSONStorage(() => AsyncStorage) },
  ),
)

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
