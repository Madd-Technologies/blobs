/**
 * What a bot's chat actually shows you last. The server's preview and "last active" time count everything stored in the
 * chat, including a bot's conversations with other bots; Home shows what you would see if you opened it. Pure.
 */

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { itemsFromHistory } from '../transcript/history.ts'

export interface VisibleActivity {
  /** What the roster said about this chat when this was read (`activityStamp`): stale once that changes. */
  stamp: string
  /** Seconds when the last visible message was sent; 0 when there is none. */
  ts: number
  /** That message, as written (markdown not yet stripped); empty when there is none. */
  text: string
  /**
   * Seconds of the newest message in an exchange you started: yours, or the bot's reply in a turn your message began. Turns
   * that background work began (a routine, a finished process or helper, a kanban event, another bot) leave it alone, so Home
   * keeps a bot where your last conversation with it put it. 0 when none was in what was read; absent on entries kept from
   * before it existed.
   */
  yours?: number
  /** The read failed: nothing is known, so Home may use the server's own preview. */
  failed?: boolean
}

/** The newest message in `rows` (oldest first) that is yours or the bot's to you, leaving out bot-to-bot exchanges. */
export function lastVisible(rows: StoredMessage[], stamp: string): VisibleActivity {
  const items = itemsFromHistory(rows)
  let yours = 0
  /** Whether the turn being read was started by a message of yours (not by a note: a routine, a wake-up, a result). */
  let yourTurn = false

  for (const item of items) {
    if (item.kind === 'user') {
      yourTurn = true
    } else if (item.kind === 'note' || item.kind === 'teammate') {
      yourTurn = false
    }

    if ((item.kind === 'user' || (item.kind === 'assistant' && yourTurn)) && !item.chatter && item.ts && item.text.trim()) {
      yours = Math.max(yours, item.ts / 1000)
    }
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]

    if (item && !item.chatter && (item.kind === 'user' || item.kind === 'assistant') && item.text.trim()) {
      return { stamp, ts: item.ts ? item.ts / 1000 : 0, text: item.text, yours }
    }
  }

  return { stamp, ts: 0, text: '', yours }
}

/**
 * A fresh read of a chat, keeping what the previous read knew of your last exchange when this one found none: its window can
 * be all background turns (a long routine, a busy kanban), and that must not move the bot.
 */
export function keepYours(next: VisibleActivity, previous: VisibleActivity | undefined): VisibleActivity {
  return next.yours || !previous?.yours ? next : { ...next, yours: previous.yours }
}

/** When you and this bot last talked, in seconds: your last exchange, or for an entry kept from before that existed, its last line. */
export const yourLastExchange = (visible: VisibleActivity): number => visible.yours ?? visible.ts

/**
 * A fingerprint of the chat's state on the roster: its `last_active` and its message count. The time can move before
 * the new messages are readable, and the count only moves with them, so either changing means read again.
 */
export function activityStamp(canonical: { last_active?: number; message_count?: number } | null | undefined): string {
  return `${canonical?.last_active ?? 0}:${canonical?.message_count ?? 0}`
}

/** What Home knows about a bot's last visible message. */
export type VisibleState =
  /** Read, though perhaps before the newest messages: shown until the fresh read replaces it, so nothing flickers. */
  | { kind: 'known'; visible: VisibleActivity }
  /** Not read yet. The server's preview is NOT used meanwhile: for a bot another bot has been talking to it is exactly
   *  the text that must stay hidden. Home shows an empty line for the second or so this takes. */
  | { kind: 'pending' }
  /** Nothing to read (no stored chat) or the read failed: the server's preview is all there is. */
  | { kind: 'server' }

export function visibleState(visible: VisibleActivity | undefined, canonical: { id?: string; resolved_id?: string } | null | undefined): VisibleState {
  if (!canonical || !(canonical.resolved_id || canonical.id)) {
    return { kind: 'server' }
  }

  if (!visible) {
    return { kind: 'pending' }
  }

  return visible.failed ? { kind: 'server' } : { kind: 'known', visible }
}

/** Whether what was read still describes the chat (nothing added since). Stale is fine to show, not to trust. */
export const isCurrent = (visible: VisibleActivity | undefined, canonical: { last_active?: number; message_count?: number } | null | undefined): boolean => !!visible && !visible.failed && visible.stamp === activityStamp(canonical)
