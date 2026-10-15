import { useEffect, useMemo } from 'react'

import { buildDeck, type DeckCard } from '@/features/inbox/deck'
import { useNow } from '@/lib/useNow'
import { useDashboards } from '@/stores/dashboards'
import { useInbox } from '@/stores/inbox'
import { useRoomViews } from '@/stores/rooms'

/**
 * Everything waiting on you as deck cards (Home's Needs-you card shows the first; Needs you works through them). Loads the
 * records each bot's dashboard flags whenever the counts change. `waiting` counts dashboard records not loaded yet too.
 */
export function useDeck(): { cards: DeckCard[]; waiting: number } {
  const { entries } = useInbox()
  const rooms = useRoomViews()
  const summary = useDashboards(state => state.summary)
  const held = useDashboards(state => state.needsYou)
  const nowS = useNow()
  // Keyed by bot and count, so a poll that changes nothing loads nothing.
  const counts = Object.keys(summary)
    .filter(profile => (summary[profile]?.needs_you ?? 0) > 0)
    .map(profile => `${profile}:${summary[profile]?.needs_you ?? 0}`)
    .join(',')
  const waitingBots = useMemo(() => (counts ? counts.split(',').map(pair => pair.slice(0, pair.lastIndexOf(':'))) : []), [counts])

  useEffect(() => {
    for (const profile of waitingBots) {
      void useDashboards.getState().loadNeedsYou(profile)
    }
  }, [waitingBots])

  return useMemo(() => {
    const cards = buildDeck({ entries, waitingBots, held, rooms, nowS })
    const dashboardCount = waitingBots.reduce((sum, profile) => sum + (summary[profile]?.needs_you ?? 0), 0)
    const loaded = cards.filter(card => card.kind === 'board').length

    return { cards, waiting: cards.length + Math.max(0, dashboardCount - loaded) }
  }, [entries, waitingBots, held, rooms, nowS, summary])
}
