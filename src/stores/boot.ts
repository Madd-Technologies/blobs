import { create } from 'zustand'

interface BootState {
  /** The cold-boot splash has played and gone: what it covered may start its own entrance. */
  splashDone: boolean
  finishSplash: () => void
}

/** What happens once per launch. Not persisted: a cold boot starts it over. */
export const useBoot = create<BootState>()(set => ({
  splashDone: false,
  finishSplash: () => set({ splashDone: true }),
}))
