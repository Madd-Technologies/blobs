import { createContext, useContext } from 'react'

import { useVisibleRows } from '@/stores/visibleRows'

/** Which row of which list a component is in, so it can tell whether that row is on screen. */
export const RowContext = createContext<{ list: string; row: string } | null>(null)

/**
 * Whether the row this component is in is on screen. True anywhere that is not a chat row (the design gallery, a viewer) so nothing
 * there waits for a list that is not there.
 */
export function useRowVisible(): boolean {
  const row = useContext(RowContext)

  return useVisibleRows(state => (row ? state.ids[`${row.list}|${row.row}`] === true : true))
}
