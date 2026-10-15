/**
 * Needs you as a deck: everything waiting on you, one card at a time. Bots' prompts first, then what their dashboards hold
 * for you, then rooms holding something for you (the order the list had). Cards you skip go to the back, in the order you
 * skipped them. Pure: `useDeck` feeds it from the stores.
 */

import type { NeedsYouRecord } from '../../lib/hermes/dashboard.ts'
import type { RoomView } from '../rooms/view.ts'
import type { InboxEntry } from './derive.ts'

export type DeckCard =
  | { kind: 'entry'; key: string; profile: string; entry: InboxEntry }
  | { kind: 'board'; key: string; profile: string; record: NeedsYouRecord; nowS: number }
  | { kind: 'room'; key: string; view: RoomView }

export interface DeckInput {
  entries: InboxEntry[]
  /** Bots whose dashboards say something needs you, in the order to show them. */
  waitingBots: string[]
  /** The records each of those dashboards flags, with the server's clock when they were read. */
  held: Record<string, { records: NeedsYouRecord[]; now: number } | undefined>
  rooms: RoomView[]
  nowS: number
}

export function buildDeck({ entries, waitingBots, held, rooms, nowS }: DeckInput): DeckCard[] {
  return [
    ...entries.map((entry): DeckCard => ({ kind: 'entry', key: entry.key, profile: entry.profile, entry })),
    ...waitingBots.flatMap(profile =>
      (held[profile]?.records ?? []).map((record): DeckCard => ({ kind: 'board', key: `board:${profile}:${record.row.id}`, profile, record, nowS: held[profile]?.now || nowS })),
    ),
    ...rooms.filter(view => view.needsYou).map((view): DeckCard => ({ kind: 'room', key: `room:${view.id}`, view })),
  ]
}

/** The deck in the order you work it: cards you skipped go behind the rest, earliest skipped first. */
export function orderDeck(cards: DeckCard[], skipped: readonly string[]): DeckCard[] {
  const later = new Map(skipped.map((key, index) => [key, index]))
  const now = cards.filter(card => !later.has(card.key))
  const back = cards.filter(card => later.has(card.key)).sort((a, b) => (later.get(a.key) ?? 0) - (later.get(b.key) ?? 0))

  return [...now, ...back]
}

/** Skip the top card: it moves to the back (and to the back again if it was skipped before). */
export function skip(skipped: readonly string[], key: string): string[] {
  return [...skipped.filter(other => other !== key), key]
}

/** The profile a card belongs to, for its tint and face; a room has none of its own. */
export function deckProfile(card: DeckCard): string | null {
  return card.kind === 'room' ? null : card.profile
}

/** "3 left", or nothing when the deck is empty. */
export function leftLabel(count: number): string {
  return count > 0 ? `${count} left` : ''
}

/**
 * Open the deck on one card (a row of Home's Needs-you sheet): the cards before it count as skipped, so it comes up first
 * and the rest follow in the same round. Nothing is skipped when the card is gone or already first.
 */
export function startAt(cards: DeckCard[], key: string | undefined): string[] {
  const at = key ? cards.findIndex(card => card.key === key) : -1

  return at > 0 ? cards.slice(0, at).map(card => card.key) : []
}
