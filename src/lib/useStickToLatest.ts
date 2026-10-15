import { useCallback, useRef, type RefObject } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

/** Within this far of the newest row (offset 0 in an inverted list) counts as being at it. */
const NEAR = 80
/** After a drag ends, how long to wait for the list to start gliding before deciding where it stopped. */
const SETTLE_MS = 120

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>

/**
 * Keeps an inverted list on its newest row while you are there: a growing reply or a new message stays in view. The moment you
 * touch the list it lets go, and it only takes hold again once the list has come to rest at the newest row.
 *
 * Deciding only when a drag ended was not enough: while a finger was still down, or the list still gliding, anything that changed
 * the list's height (older rows rendering as they scrolled in, a picture loading) pulled it back to the bottom, again and again.
 */
export function useStickToLatest<T>(list: RefObject<FlatList<T> | null>) {
  const atLatest = useRef(true)
  const moving = useRef(false)
  const offset = useRef(0)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const decide = useCallback(() => {
    if (!moving.current) {
      atLatest.current = offset.current < NEAR
    }
  }, [])

  const onScroll = useCallback((event: ScrollEvent) => {
    offset.current = event.nativeEvent.contentOffset.y
  }, [])

  const onScrollBeginDrag = useCallback(() => {
    if (settle.current) {
      clearTimeout(settle.current)
    }

    moving.current = true
    atLatest.current = false
  }, [])

  const onScrollEndDrag = useCallback(
    (event: ScrollEvent) => {
      offset.current = event.nativeEvent.contentOffset.y
      moving.current = false
      // A flick goes on gliding (onMomentumScrollBegin follows): wait a moment rather than decide on where the finger left it.
      settle.current = setTimeout(decide, SETTLE_MS)
    },
    [decide],
  )

  const onMomentumScrollBegin = useCallback(() => {
    if (settle.current) {
      clearTimeout(settle.current)
    }

    moving.current = true
  }, [])

  const onMomentumScrollEnd = useCallback(
    (event: ScrollEvent) => {
      offset.current = event.nativeEvent.contentOffset.y
      moving.current = false
      decide()
    },
    [decide],
  )

  /** The list's content changed size: stay on the newest row if that is where you are. */
  const onContentSizeChange = useCallback(() => {
    if (atLatest.current && !moving.current) {
      list.current?.scrollToOffset({ offset: 0, animated: false })
    }
  }, [list])

  /** Go to the newest row and hold it there (you sent something, or tapped "jump to latest"). */
  const toLatest = useCallback(
    (animated = true) => {
      atLatest.current = true
      list.current?.scrollToOffset({ offset: 0, animated })
    },
    [list],
  )

  return { onScroll, onScrollBeginDrag, onScrollEndDrag, onMomentumScrollBegin, onMomentumScrollEnd, onContentSizeChange, toLatest }
}
