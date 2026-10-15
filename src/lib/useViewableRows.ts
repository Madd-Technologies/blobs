import { useEffect, useState } from 'react'
import type { ViewToken } from 'react-native'

import { useVisibleRows } from '@/stores/visibleRows'

/**
 * Tells the app which rows of a list are on screen, for things that should only happen to what you can see (a photo is not
 * downloaded until its row is in view). A row counts once it has been on screen a moment, so flicking through a long chat starts
 * nothing. Spread the result onto the FlatList; `list` is this list's name, the same one its rows are given.
 */
export function useViewableRows(list: string) {
  // The list wants these two to be the same objects on every render.
  const [handlers] = useState(() => ({
    onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) =>
      useVisibleRows.getState().setRows(
        list,
        viewableItems.flatMap(token => (token.key ? [token.key] : [])),
      ),
    viewabilityConfig: { itemVisiblePercentThreshold: 10, minimumViewTime: 250 },
  }))

  useEffect(() => () => useVisibleRows.getState().clear(list), [list])

  return handlers
}
