/**
 * Work that outlives the step that started it (Hermes 0.22+, `docs/protocol.md` "Live work"): a command the server runs in the
 * background, or helpers (subagents) a bot sent off. Only what the server reports is shown: the output it relays, the
 * children it says finished, the count it said it started. Pure.
 */

import type { ProcessListRow as ProcessRow, SubagentEventPayload as SubagentPayload, SubagentListRow as SubagentRow } from '../../lib/hermes/protocol.ts'
import { formatDuration, summarizeActivity, wording, type ActivitySummary } from './activity.ts'
import type { Job, Step } from './types.ts'

/** How much of a command's output is kept for the expanded step (the server's own tail is 4000 characters). */
const OUTPUT_KEEP = 4000

const TERMINAL_STATES = new Set(['completed', 'failed', 'error', 'timeout', 'interrupted'])

function record(result: unknown): Record<string, unknown> | undefined {
  if (typeof result === 'string') {
    if (!result.trimStart().startsWith('{')) {
      return undefined
    }

    try {
      return record(JSON.parse(result))
    } catch {
      return undefined
    }
  }

  return result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : undefined
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * The id of the work a step's result says it left running: a background command (`terminal` with `background`, a timeout over
 * the foreground cap, or a command moved aside when you wrote mid-run) or helpers sent off (`delegate_task`, which always runs
 * them in the background from 0.21.5). Undefined for anything else, or a start that failed.
 */
export function jobIdOfResult(name: string, result: unknown): string | undefined {
  const value = record(result)

  if (!value || text(value.error)) {
    return undefined
  }

  const tool = name.toLowerCase()

  if (tool === 'terminal' || tool === 'process') {
    const id = text(value.session_id)
    const started = value.output === 'Background process started' || value.status === 'yielded_to_background' || 'promoted_from_foreground' in value

    return id?.startsWith('proc_') && started ? id : undefined
  }

  if (tool === 'delegate_task' && value.status === 'dispatched') {
    return text(value.delegation_id)
  }

  return undefined
}

/**
 * Whether the work this tool leaves running is followed in this chat: everything with `liveWork` (Hermes 0.22+), only helpers
 * (`delegate_task`) with `liveHelpers` (0.21.5+), where background commands keep their step's line as it always was.
 */
export function followsWorkOf(name: string, state: { liveWork?: boolean; liveHelpers?: boolean }): boolean {
  return !!state.liveWork || (!!state.liveHelpers && name.toLowerCase() === 'delegate_task')
}

/** The job a finished step left running, merged into what the server already said about it (helpers announce themselves first). */
export function jobOfResult(step: Pick<Step, 'name' | 'context' | 'args'>, result: unknown, now: number, known?: Job): Job | undefined {
  const id = jobIdOfResult(step.name, result)
  const value = record(result)

  if (!id || !value) {
    return undefined
  }

  if (step.name === 'delegate_task') {
    const ids = Array.isArray(value.subagent_ids) ? value.subagent_ids.filter((child): child is string => typeof child === 'string') : []
    const goals = Array.isArray(value.goals) ? value.goals.filter((goal): goal is string => typeof goal === 'string') : []
    const children = { ...Object.fromEntries(ids.map(child => [child, 'running' as const])), ...known?.children }
    const total = typeof value.count === 'number' ? value.count : (known?.total ?? (ids.length || undefined))

    return settle({ ...known, id, kind: 'helpers', label: known?.label || goals.join('; '), state: known?.state ?? 'running', startedAt: known?.startedAt ?? now, children, ...(total !== undefined ? { total } : {}) }, now)
  }

  const command = typeof step.args?.command === 'string' ? step.args.command : step.context
  const job: Job = { id, kind: 'command', label: command, state: 'running', startedAt: now, ...known }
  // A command moved aside when you wrote mid-run returns what it had printed so far.
  const sofar = value.status === 'yielded_to_background' && typeof value.output === 'string' && !known?.output ? value.output : ''

  return sofar ? withOutput(job, sofar) : job
}

// ── output ───────────────────────────────────────────────────────────────────────────────────────

/** Colour and cursor codes a terminal program prints. */
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

/**
 * The newest line a command printed, as a terminal would show it: a progress bar that redraws itself with `\r` reads as its last
 * frame, colour codes are dropped, blank lines are skipped.
 */
export function lastOutputLine(output: string): string | undefined {
  const lines = output
    .replace(ANSI, '')
    .split('\n')
    .map(line => (line.split('\r').filter(frame => frame.trim()).at(-1) ?? '').trim())
    .filter(Boolean)
  const line = lines.at(-1)

  return line && line.length > 140 ? `${line.slice(0, 139)}…` : line
}

/** A command's job after more output arrived (`agent.terminal.output`). */
export function withOutput(job: Job, chunk: string): Job {
  const output = `${job.output ?? ''}${chunk}`.slice(-OUTPUT_KEEP)

  return { ...job, output, line: lastOutputLine(output) ?? job.line }
}

// ── helpers (subagents) ──────────────────────────────────────────────────────────────────────────

/** Helpers are done once as many have finished as the server said it started. */
function settle(job: Job, now: number): Job {
  if (job.kind !== 'helpers' || job.state !== 'running') {
    return job
  }

  const states = Object.values(job.children ?? {})
  const finished = states.filter(state => state !== 'running').length
  const over = job.total !== undefined ? finished >= job.total : states.length > 0 && finished === states.length

  if (!over) {
    return job
  }

  return { ...job, state: states.every(state => state === 'failed') ? 'failed' : 'done', endedAt: job.endedAt ?? now }
}

/** Helpers after a `subagent.*` event, keyed by their delegation. */
export function withSubagent(job: Job | undefined, type: string, payload: SubagentPayload, now: number): Job | undefined {
  const id = payload.delegation_id ?? payload.subagent_id

  if (!id || type === 'subagent.spawn_requested') {
    return job
  }

  const child = payload.subagent_id ?? `${id}#${payload.task_index ?? 0}`
  const ended = type === 'subagent.complete' || TERMINAL_STATES.has(payload.status ?? '')
  const childState = ended ? (payload.status === 'completed' || payload.status === undefined ? 'done' : 'failed') : 'running'
  const base: Job = job ?? { id, kind: 'helpers', label: payload.goal ?? '', state: 'running', startedAt: now - (payload.duration_seconds ?? 0) * 1000 }
  const previous = base.children?.[child]
  // A child that already finished stays finished: progress frames can trail its completion.
  const next = previous && previous !== 'running' ? previous : childState
  const total = typeof payload.task_count === 'number' && payload.task_count > 0 ? Math.max(payload.task_count, base.total ?? 0) : base.total

  return settle({ ...base, children: { ...base.children, [child]: next }, ...(total !== undefined ? { total } : {}) }, now)
}

/** How many helpers finished, of how many: from the count the server gave, less the children still running. */
export function helpersDone(job: Job): { done: number; total: number } | undefined {
  const states = Object.values(job.children ?? {})
  const running = states.filter(state => state === 'running').length

  if (job.total === undefined) {
    return undefined
  }

  return { done: Math.min(job.total, Math.max(0, job.total - running)), total: job.total }
}

// ── after a reopen: what the server lists ────────────────────────────────────────────────────────

/** A command's job from its `process.list` row (the chat was opened while it ran, or the app missed its end). */
export function withProcessRow(job: Job | undefined, row: ProcessRow, now: number): Job {
  const uptimeMs = (row.uptime_seconds ?? 0) * 1000
  const exited = row.status === 'exited'
  const endedAgoMs = exited && typeof row.exited_at === 'number' ? Math.max(0, now - row.exited_at * 1000) : 0
  const output = row.output_tail ?? row.output_preview
  const base: Job = { ...job, id: row.session_id, kind: 'command', label: job?.label || row.command || '', state: job?.state ?? 'running', startedAt: job?.startedAt ?? now - uptimeMs }
  const withTail = output && output.length >= (job?.output?.length ?? 0) ? { ...base, output: output.slice(-OUTPUT_KEEP), line: lastOutputLine(output) ?? base.line } : base

  if (!exited) {
    return withTail
  }

  const exitCode = typeof row.exit_code === 'number' ? row.exit_code : undefined

  return { ...withTail, state: exitCode === 0 || exitCode === undefined ? 'done' : 'failed', endedAt: job?.endedAt ?? now - endedAgoMs, ...(exitCode !== undefined ? { exitCode } : {}) }
}

/**
 * Jobs after a fresh `process.list` and `subagent.list`. A running command the list no longer has was pruned: it is over. Helpers
 * the list no longer has finished (the list holds only live children).
 */
export function withLists(jobs: Record<string, Job> | undefined, processes: ProcessRow[] | null, subagents: SubagentRow[] | null, now: number): Record<string, Job> {
  const next: Record<string, Job> = { ...jobs }

  if (processes) {
    const listed = new Set(processes.map(row => row.session_id))

    for (const row of processes) {
      next[row.session_id] = withProcessRow(next[row.session_id], row, now)
    }

    for (const job of Object.values(next)) {
      if (job.kind === 'command' && job.state === 'running' && !listed.has(job.id)) {
        next[job.id] = { ...job, state: 'done', endedAt: now }
      }
    }
  }

  if (subagents) {
    const live = new Set(subagents.map(row => row.subagent_id))

    for (const row of subagents) {
      const id = row.delegation_id ?? row.subagent_id
      const known = next[id]
      const startedAt = typeof row.started_at === 'number' ? row.started_at * 1000 : now
      const base: Job = known ?? { id, kind: 'helpers', label: row.goal ?? '', state: 'running', startedAt }
      next[id] = { ...base, state: 'running', endedAt: undefined, children: { ...base.children, [row.subagent_id]: 'running' } }
    }

    for (const job of Object.values(next)) {
      if (job.kind !== 'helpers' || job.state !== 'running') {
        continue
      }

      const children = Object.fromEntries(Object.entries(job.children ?? {}).map(([child, state]) => [child, state === 'running' && !live.has(child) ? ('done' as const) : state]))
      next[job.id] = settle({ ...job, children }, now)
    }
  }

  return next
}

// ── how it reads ─────────────────────────────────────────────────────────────────────────────────

export interface JobLine {
  /** "Running npm run test:browsers", "3 helpers working". */
  title: string
  /** A command's newest line of output. */
  detail?: string
  /** Seconds it has been going (running) or took (finished). */
  elapsedS?: number
  /** Helpers: finished of started, as the server counted them. The only thing drawn as a bar. */
  fraction?: { done: number; total: number }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** How a job reads on its step's line and in the header. */
export function describeJob(job: Job, now: number): JobLine {
  const elapsedS = job.startedAt === undefined ? undefined : Math.max(0, ((job.endedAt ?? now) - job.startedAt) / 1000)
  const timing = elapsedS === undefined ? {} : { elapsedS }

  if (job.kind === 'helpers') {
    const counted = helpersDone(job)
    const working = Object.values(job.children ?? {}).filter(state => state === 'running').length
    const size = counted?.total ?? working

    if (job.state !== 'running') {
      return { title: `${plural(size, 'helper', 'helpers')} finished`, ...timing }
    }

    return { title: `${plural(size, 'helper', 'helpers')} working`, ...timing, ...(counted && counted.total > 1 ? { fraction: counted } : {}) }
  }

  const words = wording({ name: 'terminal', context: job.label })

  return { title: job.state === 'running' ? words.present : words.past, ...(job.line ? { detail: job.line } : {}), ...timing }
}

/**
 * A step as its job left it: a background command's step ends when the command does, with its output and exit status; helpers'
 * step ends when the last one finishes. A step whose job is unknown or still going is as the server returned it.
 */
export function withJob(step: Step, jobs: Record<string, Job> | undefined): Step {
  const job = step.jobId ? jobs?.[step.jobId] : undefined

  if (!job || job.endedAt === undefined) {
    return step
  }

  const from = step.startedAt ?? job.startedAt
  const took = from === undefined ? undefined : Math.max(step.durationS ?? 0, (job.endedAt - from) / 1000)

  return {
    ...step,
    ...(from !== undefined ? { startedAt: from } : {}),
    ...(took !== undefined ? { durationS: took } : {}),
    ...(job.output ? { output: job.output } : {}),
    ...(job.line ? { resultLine: job.line } : {}),
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
  }
}

export interface WorkSummary extends ActivitySummary {
  /** Set while the line is a job's (the steps returned, the work goes on). */
  job?: JobLine
}

/**
 * The run's one line, with its jobs: a step still running in the foreground keeps the line as always; otherwise a job still going
 * takes it ("Running npm run test:browsers · 14m 2s", its newest output under it); once every job is over the run folds to
 * "Ran 2 steps · 1h 12m", counting the time the jobs took. Without jobs it is exactly `summarizeActivity`.
 */
export function summarizeWork(steps: Step[], jobs: Record<string, Job> | undefined, now: number, carriedOn = false): WorkSummary {
  if (!jobs || steps.some(step => step.state === 'running')) {
    return summarizeActivity(steps, now, carriedOn)
  }

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Step
    const job = step.jobId ? jobs[step.jobId] : undefined

    if (job?.state === 'running') {
      const line = describeJob(job, now)

      return { kind: 'running', title: line.title, current: step, elapsedS: line.elapsedS, stepCount: steps.length, job: line }
    }
  }

  return summarizeActivity(
    steps.map(step => withJob(step, jobs)),
    now,
    carriedOn,
  )
}

/** The jobs still going, oldest first. */
export function runningJobs(jobs: Record<string, Job> | undefined): Job[] {
  return Object.values(jobs ?? {})
    .filter(job => job.state === 'running')
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

/**
 * The header's quiet line while work goes on after the turn. The header has room for a couple of dozen characters next to its
 * buttons, and the run's own line already names the command, so this only says that something runs and for how long:
 * "In the background · 14m", "Helpers · 1 of 3 done", "2 in the background".
 */
export function jobsLine(jobs: Record<string, Job> | undefined, now: number): string | undefined {
  const running = runningJobs(jobs)
  const only = running[0]

  if (!only) {
    return undefined
  }

  if (running.length > 1) {
    return `${running.length} in the background`
  }

  const line = describeJob(only, now)

  if (line.fraction) {
    return `Helpers · ${line.fraction.done} of ${line.fraction.total} done`
  }

  if (only.kind === 'helpers') {
    return line.title
  }

  return line.elapsedS === undefined ? 'In the background' : `In the background · ${roughly(line.elapsedS)}`
}

/** A duration for a line that ticks slowly: seconds only in the first minute ("45s", "14m", "1h 12m"). */
function roughly(seconds: number): string {
  return seconds >= 60 && seconds < 3600 ? `${Math.floor(seconds / 60)}m` : formatDuration(seconds)
}
