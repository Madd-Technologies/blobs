/**
 * Needs you as a deck: everything waiting on you, one card at a time. A live call's question first (it waits a minute at
 * most), then bots' prompts, calls waiting for your OK, what dashboards hold for you, what a finished call asked of you, and
 * rooms holding something for you. You move through it like a ring (up for the next card, down for the one before), and
 * cards you skip go to the back, in the order you skipped them. Pure: `useDeck` feeds it from the stores.
 */

import type { NeedsYouRecord } from '../../lib/hermes/dashboard.ts'
import type { Call, Errand } from '../../lib/hermes/phone.ts'
import type { PhoneNeeds } from '../phone/view.ts'
import type { RoomView } from '../rooms/view.ts'
import type { InboxEntry } from './derive.ts'

export type DeckCard =
  | { kind: 'entry'; key: string; profile: string; entry: InboxEntry }
  | { kind: 'board'; key: string; profile: string; record: NeedsYouRecord; nowS: number }
  | { kind: 'room'; key: string; view: RoomView }
  /** A phone errand: calls waiting for your OK, a live call's question, or what a finished call asked of you. */
  | { kind: 'phone'; key: string; profile: string; need: 'request' | 'question' | 'asked'; errand: Errand; call?: Call }

export interface DeckInput {
  entries: InboxEntry[]
  /** Bots whose dashboards say something needs you, in the order to show them. */
  waitingBots: string[]
  /** The records each of those dashboards flags, with the server's clock when they were read. */
  held: Record<string, { records: NeedsYouRecord[]; now: number } | undefined>
  rooms: RoomView[]
  /** What phone errands hold for you (none without hermes-phone). */
  phone?: PhoneNeeds
  nowS: number
}

export function buildDeck({ entries, waitingBots, held, rooms, phone, nowS }: DeckInput): DeckCard[] {
  return [
    ...(phone?.questions ?? []).map(({ errand, call }): DeckCard => ({ kind: 'phone', key: `phone:ask:${errand.id}:${call.id}`, profile: errand.profile, need: 'question', errand, call })),
    ...entries.map((entry): DeckCard => ({ kind: 'entry', key: entry.key, profile: entry.profile, entry })),
    ...(phone?.requests ?? []).map((errand): DeckCard => ({ kind: 'phone', key: `phone:ok:${errand.id}`, profile: errand.profile, need: 'request', errand })),
    ...waitingBots.flatMap(profile =>
      (held[profile]?.records ?? []).map((record): DeckCard => ({ kind: 'board', key: `board:${profile}:${record.row.id}`, profile, record, nowS: held[profile]?.now || nowS })),
    ),
    ...(phone?.asked ?? []).map((errand): DeckCard => ({ kind: 'phone', key: `phone:asked:${errand.id}`, profile: errand.profile, need: 'asked', errand })),
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

/**
 * Turn the deck like a ring: `next` sends the top card to the back (`by` cards at once, for a card tapped behind the top
 * one), `previous` brings the bottom card back to the top. Returns the new skipped list for `orderDeck`: every card but the
 * new top, in their new order.
 */
export function turn(deck: readonly DeckCard[], way: 'next' | 'previous', by = 1): string[] {
  const keys = deck.map(card => card.key)
  const count = keys.length

  if (count < 2) {
    return []
  }

  const shift = way === 'next' ? by % count : count - (by % count)
  const order = [...keys.slice(shift), ...keys.slice(0, shift)]

  return order.slice(1)
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
