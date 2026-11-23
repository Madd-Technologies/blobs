import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

/** A picture to look at: on the phone (`uri`) or on the server (`path`, read in `profile`'s scope). */
export interface ViewTarget {
  name: string
  uri?: string
  path?: string
  profile?: string
}

/** A toast's one button, such as "Undo". */
export interface ToastAction {
  label: string
  run: () => void
}

export interface BootSlice {
  splashDone: boolean
  finishSplash: () => void
}

export interface DiagramSlice {
  source: string | null
  open: (source: string) => void
  close: () => void
}

export interface ViewerSlice {
  target: ViewTarget | null
  open: (target: ViewTarget) => void
  close: () => void
}

export interface ToastSlice {
  message: string | null
  action: ToastAction | null
  nonce: number
  show: (message: string, action?: ToastAction) => void
  hide: () => void
}

interface UiState {
  boot: BootSlice
  diagram: DiagramSlice
  viewer: ViewerSlice
  toast: ToastSlice
}

/** Consolidated app-level transient UI & overlay state (cold splash, diagram viewer, image viewer, toasts). */
export const useUi = create<UiState>(set => ({
  boot: {
    splashDone: false,
    finishSplash: () => set(state => (state.boot.splashDone ? state : { boot: { ...state.boot, splashDone: true } })),
  },
  diagram: {
    source: null,
    open: source => set(state => ({ diagram: { ...state.diagram, source } })),
    close: () => set(state => ({ diagram: { ...state.diagram, source: null } })),
  },
  viewer: {
    target: null,
    open: target => set(state => ({ viewer: { ...state.viewer, target } })),
    close: () => set(state => ({ viewer: { ...state.viewer, target: null } })),
  },
  toast: {
    message: null,
    action: null,
    nonce: 0,
    show: (message, action) =>
      set(state => ({
        toast: { ...state.toast, message, action: action ?? null, nonce: state.toast.nonce + 1 },
      })),
    hide: () =>
      set(state => ({
        toast: { ...state.toast, message: null, action: null },
      })),
  },
}))

export function useBoot<T>(selector: (slice: BootSlice) => T): T {
  return useUi(state => selector(state.boot))
}

export function useDiagram<T>(selector: (slice: DiagramSlice) => T): T {
  return useUi(state => selector(state.diagram))
}

export function useViewer<T>(selector: (slice: ViewerSlice) => T): T {
  return useUi(state => selector(state.viewer))
}

export function useToast() {
  return useUi(
    useShallow(state => ({
      message: state.toast.message,
      action: state.toast.action,
      nonce: state.toast.nonce,
      hide: state.toast.hide,
    })),
  )
}

export const toast = (message: string, action?: ToastAction) => useUi.getState().toast.show(message, action)
