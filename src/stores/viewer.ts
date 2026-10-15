import { create } from 'zustand'

/** A picture to look at: on the phone (`uri`) or on the server (`path`, read in `profile`'s scope). */
export interface ViewTarget {
  name: string
  uri?: string
  path?: string
  profile?: string
}

interface ViewerState {
  target: ViewTarget | null
  open: (target: ViewTarget) => void
  close: () => void
}

export const useViewer = create<ViewerState>(set => ({ target: null, open: target => set({ target }), close: () => set({ target: null }) }))
