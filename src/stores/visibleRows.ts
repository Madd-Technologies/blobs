import { create } from 'zustand'

import { replaceRows } from '@/lib/hermes/pictureCache'

interface VisibleRowsState {
  /** `list|row` of every row on screen. */
  ids: Record<string, true>
  setRows: (list: string, keys: readonly string[]) => void
  clear: (list: string) => void
}

/** Which rows of each chat list are on screen. A row subscribes to its own entry only, so scrolling re-renders just the rows that come or go. */
export const useVisibleRows = create<VisibleRowsState>(set => ({
  ids: {},
  setRows: (list, keys) => set(state => ({ ids: replaceRows(state.ids, list, keys) })),
  clear: list => set(state => ({ ids: replaceRows(state.ids, list, []) })),
}))
