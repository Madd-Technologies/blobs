/**
 * Which bots need the user, are busy, or have something unread. Pure.
 *
 * A bot is in exactly one state. Amber (`needsYou`) always wins because it is the only thing the user
 * has to act on; busy is calm; everything else is idle. Unread is a separate flag (a bold name).
 */

import type { ActiveSessionRow, ActiveStatus, ProfileRow } from '../../lib/hermes/protocol.ts'

export type BotState = 'idle' | 'working' | 'needsYou'

/** A kanban/tool worker heartbeats at least every 60 s while running; a stamp older than this is stale. */
export const WORKER_ACTIVE_WINDOW_S = 150

export interface AttentionSignals {
  /** A prompt (approval, question, secret, sudo) is known to be waiting: seen in events, `approval.pending`, or resume. */
  hasPendingPrompt: boolean
  /** From `session.active_list`, matched to this bot. */
  activeStatus?: ActiveStatus
  /** `worker_session.last_active` from the roster row, seconds. */
  workerLastActive?: number
  /** Latest activity on the bot's chat, seconds. */
  lastActive: number
}

export interface Attention {
  state: BotState
  unread: boolean
  /** Why the bot needs you, for the "N things need you" row. */
  reason?: 'prompt' | 'waiting'
}

export interface AttentionContext {
  /** Seconds since epoch. */
  now: number
  /** The activity high-water mark the user has seen, seconds. Undefined until first seeded. */
  seenAt?: number
  /** This bot's chat is open on screen: nothing in it is unread. */
  isOpen?: boolean
}

export function workerActive(workerLastActive: number | undefined, now: number): boolean {
  return !!workerLastActive && now - workerLastActive < WORKER_ACTIVE_WINDOW_S
}

export function deriveAttention(signals: AttentionSignals, context: AttentionContext): Attention {
  const unread = !context.isOpen && context.seenAt !== undefined && signals.lastActive > context.seenAt

  if (signals.hasPendingPrompt) {
    return { state: 'needsYou', unread, reason: 'prompt' }
  }

  // `waiting` is the server's word for clarify, sudo and secret prompts (approvals are not included).
  if (signals.activeStatus === 'waiting') {
    return { state: 'needsYou', unread, reason: 'waiting' }
  }

  if (signals.activeStatus === 'working' || signals.activeStatus === 'starting' || workerActive(signals.workerLastActive, context.now)) {
    return { state: 'working', unread }
  }

  return { state: 'idle', unread }
}

/** Latest activity on a roster row, seconds (0 when it has never been used). */
export function botLastActive(row: ProfileRow): number {
  return Math.max(row.canonical_session?.last_active ?? 0, row.last_session?.last_active ?? 0)
}

/**
 * `session.active_list` has no profile field, so map its rows to bots by the stored id
 * (`session_key`) against each bot's canonical session, or by any live id we already know is the bot's.
 */
export function matchActiveToBots(
  roster: ProfileRow[],
  active: ActiveSessionRow[],
  knownLiveIds: Record<string, readonly string[]> = {},
): Map<string, ActiveSessionRow[]> {
  const byBot = new Map<string, ActiveSessionRow[]>()

  for (const bot of roster) {
    const stored = new Set([bot.canonical_session?.id, bot.canonical_session?.resolved_id].filter((id): id is string => !!id))
    const live = new Set(knownLiveIds[bot.name] ?? [])
    const rows = active.filter(row => stored.has(row.session_key) || live.has(row.id))

    if (rows.length) {
      byBot.set(bot.name, rows)
    }
  }

  return byBot
}

/** The most urgent status among a bot's active sessions: waiting beats working beats idle. */
export function strongestStatus(rows: ActiveSessionRow[] | undefined): ActiveStatus | undefined {
  if (!rows?.length) {
    return undefined
  }

  for (const status of ['waiting', 'working', 'starting', 'idle'] as const) {
    if (rows.some(row => row.status === status)) {
      return status
    }
  }

  return undefined
}
