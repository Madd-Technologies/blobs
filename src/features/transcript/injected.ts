/**
 * Messages stored as `role: "user"` that you did not write: the server waking a bot because a background process
 * finished, a model switch, or another bot's message (`message_agent`). Hermes Desktop draws them apart from what you
 * typed; so does the app. Pure.
 */

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { skillInvocation } from './userContent.ts'

/** `display_kind` values Hermes gives bookkeeping rows it stores as user turns: shown as one quiet line, not a bubble. */
const NOTE_KINDS = new Set(['process_complete', 'async_delegation_complete', 'model_switch', 'personality_switch', 'auto_continue', 'internal_notification', 'failed_turn'])

const FALLBACK: Record<string, string> = {
  process_complete: 'Background process finished',
  async_delegation_complete: 'Background work finished',
  model_switch: 'Model changed',
  personality_switch: 'Personality changed',
  auto_continue: 'Continued',
  internal_notification: 'Notice from the server',
  failed_turn: 'That turn failed',
}

function metadataOf(row: StoredMessage): Record<string, unknown> | null {
  const raw = (row as { display_metadata?: unknown }).display_metadata

  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>
  }

  // An older server can hand this back as JSON text.
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)

      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  return null
}

/**
 * Fixed texts Hermes stores as user turns with no `display_kind` (agent/context_compressor.py in 0.21.5): the request for
 * a summary when a turn runs out of steps, and the marker it leaves after compacting a chat that had no user turn left.
 */
const SERVER_TEXTS: [prefix: string, line: string][] = [
  ['You’ve reached the maximum number of tool-calling iterations allowed', 'Reached its step limit for one turn'],
  ["You've reached the maximum number of tool-calling iterations allowed", 'Reached its step limit for one turn'],
  ['Continue from the compressed conversation context above.', 'Chat compacted'],
]

/**
 * `[IMPORTANT: Background process proc_1 completed normally (exit code 0). Command: ... Output: ...]`: how Hermes wakes
 * a bot for a finished or matching process. Some sessions store it with no `display_kind`, so the wording is the signal.
 */
function injectedLine(text: string): string | null {
  const fixed = SERVER_TEXTS.find(([prefix]) => text.trim().startsWith(prefix))

  if (fixed) {
    return fixed[1]
  }

  // A skill you started is also written `[IMPORTANT: The user has invoked …]`, but it is yours: it reads as what you typed.
  if (skillInvocation(text.trim())) {
    return null
  }

  const match = /^\[IMPORTANT:\s*([\s\S]*?)\]?\s*$/.exec(text.trim())

  if (!match) {
    return null
  }

  const body = (match[1] ?? '').trim()
  const process = /^Background process \S+ (matched watch pattern|completed normally|terminated\b|marked lost|failed to start|exited)/i.exec(body)

  if (process) {
    const what = (process[1] as string).toLowerCase()

    return what.startsWith('matched')
      ? 'Background process matched a pattern'
      : what.startsWith('completed')
        ? FALLBACK.process_complete as string
        : what.startsWith('terminated')
          ? 'Background process was stopped'
          : what.startsWith('marked lost')
            ? 'Background process was lost'
            : what.startsWith('failed')
              ? 'Background process failed to start'
              : 'Background process exited with an error'
  }

  const first = body.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? ''

  return first ? first.slice(0, 140) : 'Notice from the server'
}

/** The one line for a bookkeeping row, or null when the row is something you typed. */
export function noteFor(row: StoredMessage): string | null {
  const kind = row.display_kind

  if (!kind || !NOTE_KINDS.has(kind)) {
    // No label: fall back to the wording the server uses for what it injects.
    return !kind || kind === 'hidden' ? injectedLine(String(row.display_content ?? row.content ?? '')) : null
  }

  // A process wake-up's own display text is the command line with its paths; the plain wording says more.
  if (kind === 'process_complete') {
    return FALLBACK.process_complete as string
  }

  const text = metadataOf(row)?.display_text

  return typeof text === 'string' && text.trim() ? text.replace(/\s+/g, ' ').trim().slice(0, 140) : (FALLBACK[kind] as string)
}

// ── routines ─────────────────────────────────────────────────────────────────────────────────────

/**
 * `[Cronjob "weekly-status-report" output — scheduled job, not the user. Review it, act on anything that needs
 * action, and summarize for the chat.]` and then the job's raw output: how Hermes hands a routine's result to the bot's main
 * chat (a job set to deliver to `bot-chat`) for the bot to act on and sum up (`cron/scheduler_delivery.py`, Hermes 0.21.5).
 * It is stored as a user turn with no `display_kind`, and no event marks the turn it starts, so the wording is the signal. A
 * job's name can hold quotes and brackets (Desktop names its routines `[bot:<profile>] <title>`), so the match is on the
 * fixed words after it.
 */
const ROUTINE = /^\[Cronjob\s+"([\s\S]*?)"\s+output\s+\W+\s*scheduled job, not the user\b/i

/** The routine's job name when this user-role text is a routine's output handed to the bot, else null. */
export function routineDelivery(text: string): string | null {
  const match = ROUTINE.exec(text.trim())

  return match ? (match[1] ?? '').trim() : null
}

/** The quiet line in place of a routine's raw output: `Routine “Weekly status report” ran`. */
export function routineNote(job: string): string {
  const words = job
    .replace(/^\[bot:[^\]]*\]\s*/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return words ? `Routine “${words.charAt(0).toUpperCase()}${words.slice(1)}” ran` : 'A routine ran'
}

/** `Message from 🤖 juniper (@juniper): ...`, or the older `Message from agent 'juniper': ...`. */
const TEAMMATE = /^Message from (?:agent '([^']+)'|🤖\s*([^\s(@:]+)(?:\s*\(@([^)\s]+)\))?):\s*([\s\S]*)$/i

export interface TeammateMessage {
  /** The sender's `@handle`: `hermes` for the default profile, otherwise its profile name. */
  handle: string
  text: string
}

export function teammateMessage(text: string): TeammateMessage | null {
  const match = TEAMMATE.exec(text.trim())

  if (!match) {
    return null
  }

  const handle = (match[3] ?? match[2] ?? match[1] ?? '').trim().toLowerCase()
  const body = (match[4] ?? '').trim()

  return handle && body ? { handle, text: body } : null
}

/** The profile a handle stands for: the default profile is `@hermes`. */
export const profileOfHandle = (handle: string): string => (handle === 'hermes' ? 'default' : handle)

// ── bot-to-bot exchanges ─────────────────────────────────────────────────────────────────────────

/**
 * The profile a bot-to-bot delivery was addressed to, from the wake-up Hermes stores when the delivery finishes
 * (`... bot_mode_dm.py --run-delivery ... hermes -p juniper chat --in ~ -c 'Bot Chat' ...`). `null` when the wake-up is
 * not a delivery, `undefined` when it is one whose target cannot be read (a peer or relay delivery).
 */
export function deliveryTarget(text: string): string | null | undefined {
  if (!/bot_mode_dm\.py\s+--run-delivery|tools\/bot_relay\.py/.test(text)) {
    return null
  }

  const target = /\s-p\s+([A-Za-z0-9][\w-]*)\s+chat\b/.exec(text)

  return target ? (target[1] as string).toLowerCase() : undefined
}

/** The profile a `message_agent` call is addressed to (`hermes` is the default profile), or null for a peer. */
export function messageAgentTarget(args: Record<string, unknown> | undefined): string | null {
  const raw = typeof args?.target === 'string' ? args.target.trim().replace(/^@/, '').toLowerCase() : ''

  if (!raw || raw.includes('/') || raw.includes('@')) {
    return null
  }

  return profileOfHandle(raw)
}

/**
 * `[Dashboard button "Send reply" · Late delivery, Order 4]` and then the job: the message a dashboard record's button sends
 * its bot in a fresh side chat (hermes-dashboard 0.2, `action_message`). The chat shows it as a compact bubble: the button,
 * the record, and the first line of the draft it carries (between `"""` lines), with "From your dashboard" under it.
 */
const BUTTON = /^\[Dashboard button "([^"\n]+)" · ([^\n]*)\]/

export function dashboardButton(text: string): { label: string; title: string; draft: string | null } | null {
  const match = BUTTON.exec(text.trimStart())

  if (!match) {
    return null
  }

  const draft = /\n"""\n([^\n]*)/.exec(text)?.[1]?.trim() || null

  return { label: (match[1] ?? '').trim(), title: (match[2] ?? '').trim(), draft }
}

