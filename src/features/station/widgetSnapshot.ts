/**
 * Builds the compact App Group snapshot consumed by iOS Home Screen Widgets and Lock Screen Live Activities.
 * Pure: no React Native imports.
 */

import type { DeckCard } from '../inbox/deck.ts'
import type { BotView } from '../roster/view.ts'
import type { RoomView } from '../rooms/view.ts'

export interface WidgetSnapshot {
  needsYouCount: number
  activeCount: number
  fleetPaused: boolean
  bots: { profile: string; name: string; state: string }[]
  items: { profile: string; name: string; summary: string }[]
  updatedAt: number
}

function cardOwnerName(card: DeckCard, views: readonly BotView[]): string {
  if (card.kind === 'room') {
    return card.view.name
  }

  return views.find(view => view.profile === card.profile)?.name ?? card.profile
}

function summarizeCard(card: DeckCard): string {
  switch (card.kind) {
    case 'entry':
      return card.entry.summary
    case 'board': {
      const title = card.record.row.title?.value
      return title !== undefined ? String(title) : card.record.view_title
    }
    case 'phone':
      return card.errand.brief.title || 'Phone call'
    case 'room':
      return card.view.preview || 'Waiting in room'
  }
}

export function buildWidgetSnapshot({
  views,
  rooms = [],
  cards,
  waitingCount,
  fleetPaused,
  nowS,
}: {
  views: readonly BotView[]
  rooms?: readonly RoomView[]
  cards: readonly DeckCard[]
  waitingCount?: number
  fleetPaused: boolean
  nowS: number
}): WidgetSnapshot {
  const needsYouCount = Math.max(waitingCount ?? cards.length, cards.length)
  const activeCount =
    views.filter(view => view.attention.state === 'working').length + rooms.filter(room => room.working).length

  const bots = views.slice(0, 4).map(view => ({
    profile: view.profile,
    name: view.name,
    state: view.attention.state,
  }))

  const items = cards.slice(0, 3).map(card => ({
    profile: card.kind === 'room' ? card.view.id : card.profile,
    name: cardOwnerName(card, views),
    summary: summarizeCard(card),
  }))

  return {
    needsYouCount,
    activeCount,
    fleetPaused,
    bots,
    items,
    updatedAt: Math.floor(nowS),
  }
}
