/**
 * Turns a stored transcript (REST message rows) into the same items the live reducer builds, so a
 * chat opens with its history and then continues with live events. Pure.
 */

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { deliveryTarget, noteFor, routineDelivery, routineNote, teammateMessage } from './injected.ts'
import { splitUserContent } from './userContent.ts'
import { jobIdOfResult } from './jobs.ts'
import { commandOf, isRealFailure, readResult, revealLastReply } from './reduce.ts'
import type { Item, Step } from './types.ts'

/**
 * A Codex/Responses reply kept only in `codex_message_items`, with `content` stored empty: the text of its assistant message
 * items. `analysis` is scratchpad, and raw `commentary` reaches the app only as the backend vetted it (`display_commentary`).
 */
function codexReply(raw: unknown): string {
  let items = raw

  if (typeof items === 'string') {
    try {
      items = JSON.parse(items)
    } catch {
      return ''
    }
  }

  if (!Array.isArray(items)) {
    return ''
  }

  return items
    .map(item => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
      const phase = typeof record?.phase === 'string' ? record.phase.trim().toLowerCase() : ''

      if (record?.type !== 'message' || record.role !== 'assistant' || phase === 'analysis' || phase === 'commentary' || !Array.isArray(record.content)) {
        return ''
      }

      return (record.content as unknown[])
        .map(part => {
          const piece = part && typeof part === 'object' ? (part as Record<string, unknown>) : null

          return (piece?.type === 'output_text' || piece?.type === 'text') && typeof piece.text === 'string' ? piece.text : ''
        })
        .join('')
    })
    .join('')
    .trim()
}

/**
 * What an assistant row says, in order, read the way Hermes Desktop reads it (apps/desktop/src/lib/chat-messages/hydration.ts,
 * 0.21.5): the public commentary the history backend vetted (`display_commentary`), unless it is the reply itself, then the
 * reply: `display_content`, else `content`, else a Codex reply kept only in `codex_message_items`. Codex models put what the
 * bot says beside its tool calls in that commentary and leave `content` empty, so reading `content` alone dropped it from
 * every chat read back from the server (a reopen, a reconnect), though it had shown while streaming.
 */
export function assistantTexts(row: StoredMessage): string[] {
  const commentary = Array.isArray(row.display_commentary) ? row.display_commentary.filter((part): part is string => typeof part === 'string' && part.trim() !== '').map(part => part.trim()) : []
  const reply = typeof row.display_content === 'string' ? row.display_content.trim() : (row.content ?? '').trim() || codexReply(row.codex_message_items)
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
  const sameAsReply = reply !== '' && commentary.length > 0 && squash(commentary.join('\n\n')) === squash(reply)

  return [...(sameAsReply ? [] : commentary), ...(reply ? [reply] : [])]
}

function parseJson(text: string | null | undefined): unknown {
  if (!text) {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Stored timestamps are seconds; items carry milliseconds. */
function stamp(seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : Math.round(seconds * 1000)
}

function contextOf(args: Record<string, unknown> | undefined): string {
  for (const key of ['command', 'path', 'file_path', 'query', 'url', 'name', 'target']) {
    const value = args?.[key]

    if (typeof value === 'string' && value) {
      return value
    }
  }

  return ''
}

function parseArgs(raw: string | undefined): Record<string, unknown> | undefined {
  const parsed = parseJson(raw)

  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
}

/**
 * `rows` oldest first, as the REST page returns them.
 *
 * Hermes stores everything a bot does in the person's one chat with it, including its conversations with other bots.
 * A message from a bot starts a turn whose answer goes back to that bot, not to the person: that turn comes back marked
 * `chatter`, so the chat can leave it out. When a bot hears back from a bot it messaged (the wake-up), what it says next
 * reaches no one but the person (Hermes's `bot_mode_dm.py` hands the sender only the reply of the turn its message
 * started), so that turn is theirs, whichever turn the message was sent from. Carrying `chatter` over to it once hid hours
 * of a bot's work for the person, its questions to them included, after a single message from another bot.
 *
 * A routine's output handed to the bot (`[Cronjob "…" output …]`) starts a turn of the bot working on it for the person: the
 * raw output becomes one quiet line, and of the turn only the last reply (the bot's summary) is for the person; the rest is
 * marked `chatter`. `routineFrom` is where a routine turn that is the last one read starts, still open: the caller decides
 * whether that turn is over (see `revealLastReply`).
 */
function readHistory(rows: StoredMessage[]): { items: Item[]; chatter: boolean; routineFrom: number | null } {
  const items: Item[] = []
  /** When each tool call was issued, to estimate its duration from the result row. */
  const issuedAt = new Map<string, number>()
  /** Whether the turn being read is between bots. A turn runs from a user-role row up to the next one. */
  let chatter = false
  /** Where the routine turn being read starts in `items`, or null when the turn being read is not one. */
  let routineFrom: number | null = null

  const push = (item: Item) => {
    items.push(chatter ? { ...item, chatter: true } : item)
  }

  for (const row of rows) {
    if (row.display_kind === 'hidden' || row.role === 'system') {
      continue
    }

    const id = `h-${row.id}`

    if (row.role === 'user') {
      const raw = String(row.display_content ?? row.content ?? '')
      const teammate = teammateMessage(raw.trim())
      const routine = routineDelivery(raw)

      // A user-role row ends the turn before it: a routine's turn ends with its summary shown.
      if (routineFrom !== null) {
        items.splice(routineFrom, items.length - routineFrom, ...revealLastReply(items.slice(routineFrom), 0))
        routineFrom = null
      }

      if (routine !== null) {
        // A routine's output for the bot to work on: the person sees that it ran, then only what the bot tells them.
        chatter = true
        items.push({ kind: 'note', id, text: routineNote(routine), ts: stamp(row.timestamp) })
        routineFrom = items.length

        continue
      }

      if (teammate) {
        // Another bot is talking to this one: this turn, and its answer, are between the bots.
        chatter = true
        push({ kind: 'teammate', id, ...teammate, ts: stamp(row.timestamp) })

        continue
      }

      if (deliveryTarget(raw) !== null) {
        // The answer to a message this bot sent: what it says now is for the person, even when it sent that message while
        // answering a bot.
        chatter = false
        // The plumbing line itself is never for the person.
        items.push({ kind: 'note', id, text: noteFor(row) ?? 'Background process finished', ts: stamp(row.timestamp), chatter: true })

        continue
      }

      chatter = false
      const note = noteFor(row)

      if (note) {
        push({ kind: 'note', id, text: note, ts: stamp(row.timestamp) })
      } else if (raw.trim()) {
        const { text, chips } = splitUserContent(raw)

        if (text || chips.length) {
          push({ kind: 'user', id, text, ts: stamp(row.timestamp), ...(chips.length ? { attachments: chips } : {}) })
        }
      }

      continue
    }

    if (row.role === 'assistant') {
      const texts = assistantTexts(row)

      for (const [index, text] of texts.entries()) {
        const reply = index === texts.length - 1
        // A reply the server stored with an explicit null finish reason (and no tool calls) never
        // finished: the turn was stopped. Anything else, including a missing field, is left unmarked.
        const stopped = reply && row.finish_reason === null && !row.tool_calls?.length

        push({ kind: 'assistant', id: reply ? id : `${id}-c${index}`, text, streaming: false, ts: stamp(row.timestamp), ...(stopped ? { status: 'interrupted' as const } : {}) })
      }

      for (const call of row.tool_calls ?? []) {
        const args = parseArgs(call.function.arguments)
        const step: Step = { toolId: call.id, name: call.function.name, context: contextOf(args), state: 'running', args, ...(row.timestamp !== undefined ? { startedAt: row.timestamp * 1000 } : {}) }
        const last = items.at(-1)

        if (row.timestamp !== undefined) {
          issuedAt.set(call.id, row.timestamp)
        }

        if (last?.kind === 'activity' && !!last.chatter === chatter) {
          last.steps.push(step)
        } else {
          push({ kind: 'activity', id: `${id}-act`, steps: [step] })
        }
      }

      continue
    }

    if (row.role === 'tool' && row.tool_call_id) {
      const parsed = parseJson(row.content)
      const read = readResult(parsed as Parameters<typeof readResult>[0])
      const started = issuedAt.get(row.tool_call_id)

      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]

        if (item?.kind !== 'activity') {
          continue
        }

        const step = item.steps.find(candidate => candidate.toolId === row.tool_call_id)

        if (step) {
          step.state = read.state === 'failed' && !isRealFailure(read, commandOf(step)) ? 'done' : read.state
          step.output = read.output
          step.resultLine = read.line
          step.exitCode = read.exitCode
          step.humanHasControl = read.humanHasControl
          step.image = step.name === 'image_generate' ? read.image : undefined
          step.diff = read.diff
          step.file = read.file
          step.durationS = started !== undefined && row.timestamp !== undefined ? Math.max(0, row.timestamp - started) : undefined
          // Work it left running is only followed when the server reports it (live work); otherwise this id is unused.
          const jobId = jobIdOfResult(step.name, parsed ?? row.content)

          if (jobId) {
            step.jobId = jobId
          }

          break
        }
      }
    }
  }

  return { items, chatter, routineFrom }
}

/** The items of a finished transcript: a routine turn at the end is over, so its summary shows. */
export function itemsFromHistory(rows: StoredMessage[]): Item[] {
  const { items, routineFrom } = readHistory(rows)

  return routineFrom === null ? items : revealLastReply(items, routineFrom)
}

/**
 * The items of a transcript whose last turn may still be running, and where that turn starts when it is a routine's (its
 * summary is not written yet, so nothing of it shows until it ends).
 */
export function historyWithOpenTurn(rows: StoredMessage[]): { items: Item[]; routineFrom: number | null } {
  const { items, routineFrom } = readHistory(rows)

  return { items, routineFrom }
}

/**
 * Whether the turn that `startedBy` begins (the text of a user-role row not stored yet, as `session.resume` reports a
 * running turn's) is between bots, given the rows before it. With no `startedBy`, the turn that the last stored row
 * belongs to.
 */
export function turnIsChatter(rows: StoredMessage[], startedBy?: string | null): boolean {
  if (turnIsStored(rows, startedBy)) {
    return readHistory(rows).chatter
  }

  return readHistory([...rows, { id: -1, role: 'user', content: String(startedBy).trim() } as StoredMessage]).chatter
}

/** Whether the turn `startedBy` begins is the one the rows end with (its user-role row is stored), not a newer one. */
export function turnIsStored(rows: StoredMessage[], startedBy?: string | null): boolean {
  const last = [...rows].reverse().find(row => row.role === 'user')
  const stored = last ? String(last.display_content ?? last.content ?? '').trim() : ''
  const text = startedBy?.trim()

  return !text || text === stored
}

/**
 * A step that never got a result belongs to a turn that was cut short. When no turn is running, show
 * it as stopped rather than spinning forever.
 */
export function settleStaleSteps(items: Item[]): Item[] {
  return items.map(item =>
    item.kind === 'activity' && item.steps.some(step => step.state === 'running')
      ? { ...item, steps: item.steps.map(step => (step.state === 'running' ? { ...step, state: 'failed' as const, resultLine: 'Stopped' } : step)) }
      : item,
  )
}
