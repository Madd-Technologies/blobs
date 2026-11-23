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

export type BoardCard = Extract<DeckCard, { kind: 'board' }>

/** A collapsed deck item grouping a noisy backlog view (`review` tier with >= threshold cards) into one batch card. */
export interface StackCard {
  kind: 'stack'
  key: string
  profile: string
  view: string
  viewTitle: string
  cards: BoardCard[]
}

export type DeckEntry = DeckCard | StackCard

/**
 * Turn the deck like a ring: `next` sends the top card to the back (`by` cards at once, for a card tapped behind the top
 * one), `previous` brings the bottom card back to the top. Returns the new skipped list for `orderDeck`: every card but the
 * new top, in their new order.
 */
export function turn(deck: readonly DeckCard[], way: 'next' | 'previous', by = 1): string[] {
  return turnEntries(deck, way, by)
}

/**
 * Same ring rotation over collapsed `DeckEntry` items (returning underlying `DeckCard` keys to skip for `orderDeck`)
 * so swiping past or rotating onto a `StackCard` keeps all of its grouped cards together.
 */
export function turnEntries(entries: readonly DeckEntry[], way: 'next' | 'previous', by = 1): string[] {
  const count = entries.length

  if (count < 2) {
    return []
  }

  const shift = way === 'next' ? by % count : count - (by % count)
  const order = [...entries.slice(shift), ...entries.slice(0, shift)]
  const rest = order.slice(1)

  return rest.flatMap(entry => (entry.kind === 'stack' ? entry.cards.map(card => card.key) : [entry.key]))
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

export type CardUrgency = 'blocked' | 'review'
export type CardSource = 'bot' | 'dashboard' | 'phone' | 'room'

export interface DeckFilter {
  urgency?: 'all' | CardUrgency
  profile?: string | null
  source?: CardSource | 'all' | null
}

export interface BotDeckCounts {
  profile: string
  total: number
  blocked: number
  review: number
}

export interface DeckSummary {
  blockedCount: number
  reviewCount: number
  totalCount: number
  byBot: Record<string, { total: number; blocked: number; review: number }>
  bots: BotDeckCounts[]
  sources: Record<CardSource, number>
}

export function cardSource(card: DeckCard): CardSource {
  switch (card.kind) {
    case 'entry':
      return 'bot'
    case 'board':
      return 'dashboard'
    case 'phone':
      return 'phone'
    case 'room':
      return 'room'
  }
}

/**
 * Interactive decisions that block a live turn or call (plus dashboard views configured as `inbox: 'interrupt'`) come
 * first ('blocked'); queued dashboard cards and asked phone follow-ups sit under 'review' so triage stays calm.
 */
export function cardUrgency(card: DeckCard): CardUrgency {
  if (card.kind === 'board') {
    return card.record.inbox === 'interrupt' ? 'blocked' : 'review'
  }

  if (card.kind === 'phone') {
    return card.need === 'asked' ? 'review' : 'blocked'
  }

  return 'blocked'
}

export function filterDeck(cards: readonly DeckCard[], filter: DeckFilter): DeckCard[] {
  const urgency = filter.urgency && filter.urgency !== 'all' ? filter.urgency : null
  const profile = filter.profile ?? null
  const source = filter.source && filter.source !== 'all' ? filter.source : null

  if (!urgency && !profile && !source) {
    return [...cards]
  }

  return cards.filter(card => {
    if (urgency && cardUrgency(card) !== urgency) {
      return false
    }

    if (profile && deckProfile(card) !== profile) {
      return false
    }

    if (source && cardSource(card) !== source) {
      return false
    }

    return true
  })
}

export function deckSummary(cards: readonly DeckCard[], pendingBoardCount = 0): DeckSummary {
  let blockedCount = 0
  let reviewCount = 0
  const byBot: Record<string, { total: number; blocked: number; review: number }> = {}
  const sources: Record<CardSource, number> = { bot: 0, dashboard: 0, phone: 0, room: 0 }

  for (const card of cards) {
    const urgency = cardUrgency(card)
    sources[cardSource(card)]++

    if (urgency === 'blocked') {
      blockedCount++
    } else {
      reviewCount++
    }

    const profile = deckProfile(card)

    if (profile) {
      const bucket = byBot[profile] ?? (byBot[profile] = { total: 0, blocked: 0, review: 0 })
      bucket.total++

      if (urgency === 'blocked') {
        bucket.blocked++
      } else {
        bucket.review++
      }
    }
  }

  const unloadedBoard = Math.max(0, pendingBoardCount)
  reviewCount += unloadedBoard
  sources.dashboard += unloadedBoard
  const bots: BotDeckCounts[] = Object.entries(byBot)
    .map(([profile, counts]) => ({ profile, ...counts }))
    .sort((a, b) => b.blocked - a.blocked || b.total - a.total || a.profile.localeCompare(b.profile))

  return { blockedCount, reviewCount, totalCount: blockedCount + reviewCount, byBot, bots, sources }
}

/** Board cards flagged as stale by the server or un-updated for at least `days` days. */
export function staleBoardIds(cards: readonly DeckCard[], nowS: number, days = 7): { key: string; profile: string; id: string }[] {
  const cutoff = Math.max(1, days) * 86_400
  const stale: { key: string; profile: string; id: string }[] = []

  for (const card of cards) {
    if (card.kind !== 'board') {
      continue
    }

    const updated = card.record.updated_at

    if (card.record.stale === true || (typeof updated === 'number' && updated > 0 && nowS - updated >= cutoff)) {
      stale.push({ key: card.key, profile: card.profile, id: card.record.row.id })
    }
  }

  return stale
}

/**
 * Collapses noisy non-interrupt dashboard views (at least `threshold` cards from the same `${profile}/${view}`)
 * into one `StackCard` at the position of the first card in that group, keeping urgent/small items on top.
 */
export function collapseDeckStacks(cards: readonly DeckCard[], threshold = 4): DeckEntry[] {
  if (threshold <= 1 || cards.length === 0) {
    return [...cards]
  }

  const groups = new Map<string, BoardCard[]>()

  for (const card of cards) {
    if (card.kind !== 'board' || cardUrgency(card) === 'blocked') {
      continue
    }

    const groupKey = `${card.profile}/${card.record.view}`
    const bucket = groups.get(groupKey)

    if (bucket) {
      bucket.push(card)
    } else {
      groups.set(groupKey, [card])
    }
  }

  const emitted = new Set<string>()
  const entries: DeckEntry[] = []

  for (const card of cards) {
    if (card.kind !== 'board' || cardUrgency(card) === 'blocked') {
      entries.push(card)
      continue
    }

    const groupKey = `${card.profile}/${card.record.view}`
    const bucket = groups.get(groupKey)

    if (!bucket || bucket.length < threshold) {
      entries.push(card)
      continue
    }

    if (emitted.has(groupKey)) {
      continue
    }

    emitted.add(groupKey)
    entries.push({
      kind: 'stack',
      key: `stack:${groupKey}`,
      profile: card.profile,
      view: card.record.view,
      viewTitle: card.record.view_title || 'Dashboard queue',
      cards: bucket,
    })
  }

  return entries
}

/**
 * Picks up to `limit` preview cards for Home's Needs-you sheet, round-robin across distinct bots/rooms first so one
 * bot's large queue doesn't hide other waiting bots behind "and N more".
 */
export function pickPreviewCards(cards: readonly DeckCard[], limit: number): DeckCard[] {
  if (limit <= 0 || cards.length === 0) {
    return []
  }

  const picked: DeckCard[] = []
  const seenOwners = new Set<string>()
  const deferred: DeckCard[] = []

  for (const card of cards) {
    const owner = deckProfile(card) ?? card.key

    if (!seenOwners.has(owner)) {
      seenOwners.add(owner)
      picked.push(card)

      if (picked.length === limit) {
        return picked
      }
    } else {
      deferred.push(card)
    }
  }

  for (const card of deferred) {
    picked.push(card)

    if (picked.length === limit) {
      break
    }
  }

  return picked
}

/** Prompt sent to a bot's side chat when the user asks it to triage a crowded Needs-you queue. */
export function triagePrompt(botName: string, count: number, viewTitle?: string): string {
  const noun = count === 1 ? 'item' : 'items'
  const where = viewTitle ? ` in "${viewTitle}" (${botName})` : ` on ${botName}'s dashboard`

  return `I have ${count} ${noun} waiting for review${where}. Triage them for me: list which genuinely need my decision now, which can be closed or snoozed safely, and your recommended action for each.`
}
