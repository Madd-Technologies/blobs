/**
 * Turns a stored transcript (REST message rows) into the same items the live reducer builds, so a
 * chat opens with its history and then continues with live events. Pure.
 */

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { deliveryTarget, messageAgentTarget, noteFor, routineDelivery, routineNote, teammateMessage } from './injected.ts'
import { splitUserContent } from './userContent.ts'
import { jobIdOfResult } from './jobs.ts'
import { commandOf, isRealFailure, readResult, revealLastReply } from './reduce.ts'
import type { Item, Step } from './types.ts'

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
 * A message from a bot starts a turn whose answer goes back to that bot, not to the person, and a bot that messaged
 * another bot on its own (while answering a bot) hears back the same way. Those items come back marked `chatter`, so
 * the chat can leave them out. A bot that messaged another for the person keeps the turn where it hears back: that is
 * where it reports to them.
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
  /** Messages this bot sent to other bots whose answer has not come back yet, oldest first. */
  const outgoing: { target: string | null; chatter: boolean }[] = []
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
      const target = deliveryTarget(raw)
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

      if (target !== null) {
        // The answer to a message this bot sent. It is between bots when that message was sent while answering a bot.
        const at = outgoing.findIndex(entry => target === undefined || entry.target === null || entry.target === target)
        const sent = at >= 0 ? outgoing.splice(at, 1)[0] : undefined
        chatter = sent?.chatter ?? false
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
      const text = (row.content ?? '').trim()

      if (text) {
        // A reply the server stored with an explicit null finish reason (and no tool calls) never
        // finished: the turn was stopped. Anything else, including a missing field, is left unmarked.
        const stopped = row.finish_reason === null && !row.tool_calls?.length

        push({ kind: 'assistant', id, text, streaming: false, ts: stamp(row.timestamp), ...(stopped ? { status: 'interrupted' as const } : {}) })
      }

      for (const call of row.tool_calls ?? []) {
        const args = parseArgs(call.function.arguments)
        const step: Step = { toolId: call.id, name: call.function.name, context: contextOf(args), state: 'running', args, ...(row.timestamp !== undefined ? { startedAt: row.timestamp * 1000 } : {}) }
        const last = items.at(-1)

        if (call.function.name === 'message_agent') {
          outgoing.push({ target: messageAgentTarget(args), chatter })
        }

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
