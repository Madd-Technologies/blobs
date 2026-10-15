/**
 * What the chat actually draws: the transcript items in order, with a quiet date label between
 * stretches of conversation, and thinking hidden unless asked for. Pure.
 */

import type { Item, Phase } from './types.ts'

export type DisplayItem =
  | { kind: 'date'; id: string; label: string }
  | {
      kind: 'item'
      item: Item
      /** An activity: the pictures its steps made, to draw under its line. */
      made?: string[]
      /** A reply: the pictures a tool already made earlier in this turn, so the reply does not draw them again. */
      drawn?: string[]
      /** An activity: the bot did more after it in the same turn (or is still going), so a failure it ended on was handled. */
      carriedOn?: boolean
      /** A reply: the bot's last words in a finished turn, which get the copy, read aloud and share buttons. */
      endsTurn?: boolean
      /** A reply that ends the chat's latest turn: the one Retry asks again. */
      lastTurn?: boolean
    }

/** A gap longer than this starts a new stretch, with its own date label. */
const GAP_MS = 30 * 60 * 1000

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(date: Date): string {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)

  return date.getTime()
}

/** "Today 9:38 AM", "Yesterday 4:12 PM", "Mon 4:12 PM" (this week), "Oct 6, 4:12 PM", "Oct 6, 2025, 4:12 PM". */
export function formatStamp(ts: number, now: number): string {
  const date = new Date(ts)
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000)

  if (days <= 0) {
    return `Today ${clock(date)}`
  }

  if (days === 1) {
    return `Yesterday ${clock(date)}`
  }

  if (days < 7) {
    return `${DAYS[date.getDay()]} ${clock(date)}`
  }

  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : `, ${date.getFullYear()}`

  return `${day}${year}, ${clock(date)}`
}

/** What the bot does next that shows it moved past a run of steps. Errors, a stop and thinking alone do not. */
const CONTINUES = new Set<Item['kind']>(['assistant', 'activity', 'approval', 'question', 'secret', 'sudo', 'teammate', 'note', 'output'])

/**
 * The activities the bot carried on after: something it did follows in the same turn, or the turn (the last one) is still
 * running. Walks back from the end, forgetting what it has seen at each message of yours.
 */
export function carriedOnIds(items: Item[], running: boolean): Set<string> {
  const ids = new Set<string>()
  let after = running

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index] as Item

    if (item.kind === 'user') {
      after = false
      continue
    }

    if (item.kind === 'activity' && after) {
      ids.add(item.id)
    }

    after = after || CONTINUES.has(item.kind)
  }

  return ids
}

/**
 * The bot's last reply in each finished turn (the words it ended on, not "Looking it up…" along the way), and which of them ends
 * the latest turn. A turn still running has none yet.
 */
export function turnEnds(items: Item[], running: boolean): { ends: Set<string>; last: string | null } {
  const ends = new Set<string>()
  let last: string | null = null
  let candidate: string | null = null
  let latest = true

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index] as Item

    if (item.kind === 'user') {
      if (candidate && !(latest && running)) {
        ends.add(candidate)
        last ??= latest ? candidate : null
      }

      candidate = null
      latest = false
      continue
    }

    if (!candidate && item.kind === 'assistant' && !item.chatter && !item.streaming && item.text.trim()) {
      candidate = item.id
    }
  }

  if (candidate && !(latest && running)) {
    ends.add(candidate)
    last ??= latest ? candidate : null
  }

  return { ends, last }
}

function timeOf(item: Item): number | undefined {
  return item.kind === 'user' || item.kind === 'assistant' || item.kind === 'teammate' ? item.ts : undefined
}

export function buildDisplay(items: Item[], options: { now: number; showThinking: boolean; showChatter?: boolean; chatterFrom?: number | null; running?: boolean }): DisplayItem[] {
  const out: DisplayItem[] = []
  const carriedOn = carriedOnIds(items, options.running ?? false)
  const turns = turnEnds(items, options.running ?? false)
  let last: number | undefined
  /** Pictures tools have made since you last spoke. */
  let turn: string[] = []

  for (const [index, item] of items.entries()) {
    if (item.kind === 'thinking' && !options.showThinking) {
      continue
    }

    // What happened between bots is kept in the transcript but not drawn, unless asked for.
    if ((item.chatter || (options.chatterFrom != null && index >= options.chatterFrom)) && !options.showChatter) {
      continue
    }

    const ts = timeOf(item)

    if (ts !== undefined && (last === undefined || ts - last >= GAP_MS || startOfDay(ts) !== startOfDay(last))) {
      out.push({ kind: 'date', id: `date-${item.id}`, label: formatStamp(ts, options.now) })
    }

    if (ts !== undefined) {
      last = ts
    }

    if (item.kind === 'user') {
      turn = []
    }

    const made = item.kind === 'activity' ? item.steps.flatMap(step => (step.image ? [step.image] : [])) : []

    turn.push(...made)
    out.push({
      kind: 'item',
      item,
      ...(made.length ? { made } : {}),
      ...(item.kind === 'assistant' && turn.length ? { drawn: [...turn] } : {}),
      ...(carriedOn.has(item.id) ? { carriedOn: true } : {}),
      ...(turns.ends.has(item.id) ? { endsTurn: true } : {}),
      ...(turns.last === item.id ? { lastTurn: true } : {}),
    })
  }

  return out
}

/**
 * The quiet header line while a turn runs. The server's own status text ("recalled 102 memories") is
 * about the moment it was sent, so it shows only while the bot is still thinking; once text is flowing
 * or a tool is running, the phase is the truer thing to say.
 */
export function runningLine(phase: Phase, statusLine: string | null): string {
  if (phase === 'writing') {
    return 'Writing…'
  }

  if (phase === 'tool') {
    return 'Working…'
  }

  return statusLine || 'Thinking…'
}
