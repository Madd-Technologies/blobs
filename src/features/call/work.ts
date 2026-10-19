/**
 * What the call screen shows of the work a call handed to the bot: the steps of the newest turn the call started in the chat,
 * one quiet line each while it runs, and its one summary line once it is over ("Ran 3 steps · 18s"). Pure, over the chat's
 * transcript items.
 */

import { summarizeActivity, wording } from '../transcript/activity.ts'
import type { Item, Step, StepState } from '../transcript/types.ts'

/** The step lines the call screen has room for under the caption: the newest ones. */
export const WORK_LINES = 2

export interface WorkLine {
  id: string
  state: StepState
  /** "Searching email for the dentist" while it runs, "Read tomorrow’s calendar" once done. */
  text: string
  /** Seconds it took, once finished. */
  durationS?: number
  /** When it started (ms), for a running step's clock. */
  startedAt?: number
}

export type CallWork = { kind: 'running'; lines: WorkLine[] } | { kind: 'done'; summary: string; failed: boolean }

function line(step: Step): WorkLine {
  const words = wording(step)

  return {
    id: step.toolId,
    state: step.state,
    text: step.state === 'running' ? words.present : words.past,
    ...(step.durationS !== undefined ? { durationS: step.durationS } : {}),
    ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
  }
}

/**
 * The work of the newest turn the call started: the chat's last message from you, when it was sent during the call (`since`, ms),
 * and the steps after it. Null when the call has handed nothing over yet, or that turn used no tools. `running` is whether the
 * chat's turn is still going (the transcript's own flag, so the time between two steps still reads as work).
 */
export function callWork(items: readonly Item[], since: number | null, running: boolean, max: number = WORK_LINES): CallWork | null {
  if (!since) {
    return null
  }

  let from = -1

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]

    if (item?.kind === 'user') {
      from = item.ts !== undefined && item.ts >= since ? i : -1
      break
    }
  }

  if (from < 0) {
    return null
  }

  const steps = items.slice(from + 1).flatMap(item => (item.kind === 'activity' ? item.steps : []))

  if (!steps.length) {
    return null
  }

  if (running) {
    return { kind: 'running', lines: steps.slice(-max).map(line) }
  }

  const summary = summarizeActivity(steps)

  return { kind: 'done', summary: summary.title, failed: summary.kind === 'failed' }
}
