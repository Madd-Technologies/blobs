import { create } from 'zustand'

import { registerServerReset } from '@/stores/reset'

interface Draft {
  text: string
  /** Changes with every explicit handoff, so a chat box that is already open takes it. */
  nonce: number
}

interface DraftsState {
  byBot: Record<string, Draft | undefined>
  /** Puts a prompt into the composer (bumping nonce so an open composer adopts it). */
  set: (profile: string, text: string) => void
  /** Silently saves in-progress composer text across screen navigation without bumping nonce. */
  save: (profile: string, text: string) => void
  clear: (profile: string) => void
}

/** Words to put in a bot's message box or keep across navigation while typing. Only lives while the app does. */
export const useDrafts = create<DraftsState>(set => ({
  byBot: {},
  set: (profile, text) => set(state => ({ byBot: { ...state.byBot, [profile]: { text, nonce: (state.byBot[profile]?.nonce ?? 0) + 1 } } })),
  save: (profile, text) =>
    set(state => {
      if (!text) {
        if (!(profile in state.byBot)) {
          return state
        }

        const { [profile]: _gone, ...rest } = state.byBot

        return { byBot: rest }
      }

      const prev = state.byBot[profile]

      if (prev?.text === text) {
        return state
      }

      return { byBot: { ...state.byBot, [profile]: { text, nonce: prev?.nonce ?? 0 } } }
    }),
  clear: profile =>
    set(state => {
      if (!(profile in state.byBot)) {
        return state
      }

      const { [profile]: _gone, ...rest } = state.byBot

      return { byBot: rest }
    }),
}))

registerServerReset(() => {
  useDrafts.setState({ byBot: {} })
})
