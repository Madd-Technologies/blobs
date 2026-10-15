import { create } from 'zustand'

interface Draft {
  text: string
  /** Changes with every new draft, so a chat box that is already open takes it. */
  nonce: number
}

interface DraftsState {
  byBot: Record<string, Draft | undefined>
  set: (profile: string, text: string) => void
  clear: (profile: string) => void
}

/** Words to put in a bot's message box when its chat opens ("Set up a routine that…"). Only lives while the app does. */
export const useDrafts = create<DraftsState>(set => ({
  byBot: {},
  set: (profile, text) => set(state => ({ byBot: { ...state.byBot, [profile]: { text, nonce: (state.byBot[profile]?.nonce ?? 0) + 1 } } })),
  clear: profile =>
    set(state => {
      const { [profile]: _gone, ...rest } = state.byBot

      return { byBot: rest }
    }),
}))
