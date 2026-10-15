import { create } from 'zustand'

/** A toast's one button, such as "Undo". */
export interface ToastAction {
  label: string
  run: () => void
}

interface ToastState {
  message: string | null
  action: ToastAction | null
  /** Bumps on every show so an identical message re-appears. */
  nonce: number
  show: (message: string, action?: ToastAction) => void
  hide: () => void
}

/** One quiet message at a time ("Coming soon", "Couldn't send"). */
export const useToast = create<ToastState>(set => ({
  message: null,
  action: null,
  nonce: 0,
  show: (message, action) => set(state => ({ message, action: action ?? null, nonce: state.nonce + 1 })),
  hide: () => set({ message: null, action: null }),
}))

export const toast = (message: string, action?: ToastAction) => useToast.getState().show(message, action)
