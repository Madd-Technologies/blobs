import { create } from 'zustand'

interface DiagramState {
  /** The Mermaid source being looked at full screen; null when none is. */
  source: string | null
  open: (source: string) => void
  close: () => void
}

export const useDiagram = create<DiagramState>(set => ({ source: null, open: source => set({ source }), close: () => set({ source: null }) }))
