/**
 * Messages stored as `role: "user"` that you did not write: the server waking a bot because a background process
 * finished, a model switch, or another bot's message (`message_agent`). Hermes Desktop draws them apart from what you
 * typed; so does the app. Pure.
 */

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { formatDuration } from './activity.ts'
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
 * a summary when a turn runs out of steps, the marker it leaves after compacting a chat that had no user turn left, and
 * your last request copied back in after a compaction (`_reappend_inflight_user_task`). That copy keeps your words and
 * your row's fields, so without this it reads as a second message from you.
 */
const SERVER_TEXTS: [prefix: string, line: string][] = [
  ['You’ve reached the maximum number of tool-calling iterations allowed', 'Reached its step limit for one turn'],
  ["You've reached the maximum number of tool-calling iterations allowed", 'Reached its step limit for one turn'],
  ['Continue from the compressed conversation context above.', 'Chat compacted'],
  ['[STILL IN PROGRESS — this is the active request, restated after the compaction boundary', 'Chat compacted · picked your last request back up'],
]

// ── helpers' results ────────────────────────────────────────────────────────────────────────────

/**
 * How Hermes words a batch of helpers' outcome (`async_delegation_display_text`, tools/process_registry_notifications.py at
 * v0.22.2): "Subagent Task Completed: <goal>", "Subagent Tasks Finished with Issues: <goals> (3 tasks)".
 */
const HELPERS_TITLE = /^Subagent Tasks? (Completed|Incomplete|Failed|Cancelled|Interrupted|Timed Out|Stalled|Unknown|Finished with Issues)\b/

/** True for Hermes's title for helpers' results: the `status.update` that announces the turn they wake the bot for. */
export function isHelpersResult(text: string): boolean {
  return HELPERS_TITLE.test(text.trim())
}

/** What happened to them, for one helper and for several. "Incomplete" is a helper that hit its step limit (max_iterations). */
const HELPERS_OUTCOME: Record<string, [one: string, many: string]> = {
  Completed: ['finished', 'finished'],
  Failed: ['failed', 'failed'],
  Incomplete: ['stopped at its step limit', 'stopped at their step limit'],
  Cancelled: ['was cancelled', 'were cancelled'],
  Interrupted: ['was stopped', 'were stopped'],
  'Timed Out': ['timed out', 'timed out'],
  Stalled: ['stalled', 'stalled'],
  Unknown: ['ended', 'ended'],
}

const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined)

/**
 * The one line for helpers' results (`delegate_task` children that ran in the background, Hermes 0.21.6+): "3 helpers finished ·
 * 5m 2s", "3 helpers finished · 1 failed", "A helper timed out". Hermes's own display text lists every goal in full, which is the
 * model's business; this says how many, whether any failed and how long it took. `outcome` is Hermes's word for it.
 */
export function helpersLine(found: { total?: number; failed?: number; outcome?: string; durationS?: number }): string {
  const total = found.total && found.total > 0 ? found.total : 1
  const failed = found.failed ?? 0
  const who = total === 1 ? 'A helper' : `${total} helpers`
  const outcome = found.outcome ?? (failed >= total ? 'Failed' : failed > 0 ? 'Finished with Issues' : 'Completed')
  const words = HELPERS_OUTCOME[outcome]
  const what = words ? (total === 1 ? words[0] : words[1]) : failed > 0 ? `finished · ${failed} failed` : 'finished, not all cleanly'
  const took = found.durationS !== undefined && found.durationS > 0 ? ` · ${formatDuration(found.durationS)}` : ''

  return `${who} ${what}${took}`
}

/** Helpers' results from a labelled row: the counts Hermes keeps in `display_metadata`, or null when it is not that kind of row. */
function helpersFromMetadata(meta: Record<string, unknown> | null): string | null {
  const text = typeof meta?.display_text === 'string' ? meta.display_text.trim() : ''
  const title = HELPERS_TITLE.exec(text)
  const total = count(meta?.task_count)

  if (!title && total === undefined) {
    return null
  }

  const durationS = typeof meta?.duration_seconds === 'number' ? meta.duration_seconds : undefined

  return helpersLine({ total, failed: count(meta?.failed_count), outcome: title?.[1], durationS })
}

/**
 * Helpers' results stored with no label: the wording Hermes wakes the bot with (`[ASYNC DELEGATION COMPLETE — deleg_…]`, `…
 * BATCH COMPLETE — deleg_…]` with "3 subagent(s)" and a ✓/✗ per task, `… TASK FAILED — deleg_…, task 2/3]`).
 */
function helpersFromText(text: string): string | null {
  const head = /^\[ASYNC DELEGATION (COMPLETE|BATCH COMPLETE|TASK FAILED)\b[^\]]*\]/.exec(text.trim())

  if (!head) {
    return null
  }

  if (head[1] === 'TASK FAILED') {
    return helpersLine({ total: 1, failed: 1 })
  }

  if (head[1] === 'COMPLETE') {
    const status = /^Status:\s*(\w+)/m.exec(text)?.[1]?.toLowerCase()

    return helpersLine({ total: 1, failed: status === 'failed' || status === 'error' ? 1 : 0 })
  }

  const total = count(Number(/(\d+) subagent\(s\)/.exec(text)?.[1]))
  const failed = (text.match(/^--- ✗ TASK /gm) ?? []).length

  return helpersLine({ total, failed })
}

/**
 * `[Phone errand finished · "Septic pump-out quotes" · e_ab12 · 2 quoted, 1 call back] Read the details with
 * phone_call_report.`: the fixed line hermes-phone gives the bot's main chat when an errand's calls are done. It carries no
 * words from the calls, only the title the bot wrote and the counts.
 */
const PHONE_FINISHED = /^\[Phone errand finished · "([^"\n]*)" · (\S+) · ([^\]\n]*)\]/

export function phoneFinished(text: string): { title: string; errand: string; summary: string } | null {
  const match = PHONE_FINISHED.exec(text.trim())

  return match ? { title: (match[1] ?? '').trim(), errand: match[2] ?? '', summary: (match[3] ?? '').trim() } : null
}

/**
 * A kanban event Hermes wakes the chat that queued the task with (tui_gateway/session_notifications.py): a mark, maybe
 * `[board]` and `@bot`, then `Kanban t_…` and what happened ("✔ @scribe Kanban t_ab12 done — Write the release notes").
 */
const KANBAN = /^[\u2714\u23F8\u2716\u23F1\u{1F504}]\uFE0F?\s+(?:\[[^\]]+\]\s+)?(?:@\S+\s+)?(Kanban\s+t_\S+[\s\S]*)$/u

/**
 * `[IMPORTANT: Background process proc_1 completed normally (exit code 0). Command: ... Output: ...]`: how Hermes wakes
 * a bot for a finished or matching process. Some sessions store it with no `display_kind`, so the wording is the signal.
 */
function injectedLine(text: string): string | null {
  const fixed = SERVER_TEXTS.find(([prefix]) => text.trim().startsWith(prefix))

  if (fixed) {
    return fixed[1]
  }

  const phone = phoneFinished(text)

  if (phone) {
    return `Phone errand finished · ${phone.title}${phone.summary ? ` · ${phone.summary}` : ''}`
  }

  const helpers = helpersFromText(text)

  if (helpers) {
    return helpers
  }

  // A kanban task this chat queued changed state: its first line, without the mark and the names.
  const kanban = KANBAN.exec(text.trim().split('\n')[0] ?? '')

  if (kanban) {
    return (kanban[1] as string).replace(/\s+/g, ' ').trim().slice(0, 140)
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

  const meta = metadataOf(row)
  // Helpers' results: the server's display text names every goal; the counts say what matters.
  const helpers = kind === 'async_delegation_complete' ? helpersFromMetadata(meta) : null

  if (helpers) {
    return helpers
  }

  const text = meta?.display_text

  if (typeof text === 'string' && text.trim()) {
    return text.replace(/\s+/g, ' ').trim().slice(0, 140)
  }

  return (kind === 'async_delegation_complete' ? helpersFromText(String(row.content ?? '')) : null) ?? (FALLBACK[kind] as string)
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

