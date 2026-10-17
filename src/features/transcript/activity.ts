/**
 * Wording for tool steps: the one quiet line the chat shows instead of a card per tool call. Pure.
 */

import type { Step } from './types.ts'

function basename(path: string): string {
  const clean = path.replace(/\/+$/, '')

  return clean.slice(clean.lastIndexOf('/') + 1) || clean
}

/** `Array.prototype.findLast` without relying on the JS engine shipping it. */
function lastWhere<T>(list: T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]

    if (item !== undefined && test(item)) {
      return item
    }
  }

  return undefined
}

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** "12s", "1m 12s", "2h 3m". Sub-second durations read as "<1s". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) {
    return '<1s'
  }

  const total = Math.round(seconds)

  if (total < 60) {
    return `${total}s`
  }

  if (total < 3600) {
    return `${Math.floor(total / 60)}m ${total % 60}s`
  }

  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`
}

interface Wording {
  /** While it runs: "Running docker compose pull". */
  present: string
  /** Once finished: "Ran docker compose pull". */
  past: string
}

/** What wording needs of a step; a step from a stored chat or a test may lack its target. */
type StepLike = Pick<Step, 'name' | 'args'> & { context?: string }

/** The first readable target in a tool's arguments, as the chat line names it. */
function targetOf(args: Record<string, unknown> | undefined): string {
  for (const key of ['command', 'path', 'file_path', 'query', 'url', 'name', 'collection']) {
    const value = args?.[key]

    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  const urls = args?.urls

  return Array.isArray(urls) && typeof urls[0] === 'string' ? urls[0] : ''
}

function argsOf(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    try {
      return argsOf(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined
}

/**
 * Hermes hands deferred and plugin tools to the model through `tool_call` (`tools/tool_labels.py`, 0.21.5), so the step is the
 * tool it called: `{calls: [{name, arguments}]}`, or one `{name, arguments}`. `more` counts the other calls in the same step.
 */
export function calledTool(step: StepLike): StepLike & { more: number } {
  if (step.name.toLowerCase() !== 'tool_call') {
    return { ...step, more: 0 }
  }

  const raw = step.args?.calls
  const calls = (Array.isArray(raw) ? raw : [step.args]).map(argsOf).filter(call => typeof call?.name === 'string' && call.name !== '')
  const first = calls[0]

  if (!first) {
    return { ...step, more: 0 }
  }

  const args = argsOf(first.arguments)

  return { name: first.name as string, context: targetOf(args), args, more: calls.length - 1 }
}

/** The app's dashboard plugin's tools (hermes-dashboard), in the words of what they do. */
const DASHBOARD_WORDS: Record<string, Wording> = {
  dashboard_query: { present: 'Reading the dashboard', past: 'Read the dashboard' },
  dashboard_record: { present: 'Updating the dashboard', past: 'Updated the dashboard' },
  dashboard_view: { present: 'Changing a dashboard panel', past: 'Changed a dashboard panel' },
  dashboard_collection: { present: 'Setting up the dashboard', past: 'Set up the dashboard' },
}

/** How a step reads, e.g. `terminal` → "Running <command>" / "Ran <command>". */
export function wording(step: StepLike): Wording {
  const called = calledTool(step)

  if (called.more > 0) {
    const first = wording({ name: called.name, context: called.context, args: called.args })

    return { present: `${first.present} and ${called.more} more`, past: `${first.past} and ${called.more} more` }
  }

  const target = called.context ?? ''
  const name = called.name.toLowerCase()

  if (name === 'terminal' || name === 'process') {
    const command = clip(target, 60)

    return { present: command ? `Running ${command}` : 'Running a command', past: command ? `Ran ${command}` : 'Ran a command' }
  }

  if (name === 'read_file') {
    return { present: `Reading ${basename(target)}`, past: `Read ${basename(target)}` }
  }

  if (name === 'write_file' || name === 'patch') {
    return { present: `Editing ${basename(target)}`, past: `Edited ${basename(target)}` }
  }

  if (name === 'search_files') {
    return { present: `Searching ${clip(target, 40)}`, past: `Searched ${clip(target, 40)}` }
  }

  if (name === 'web_search') {
    const query = clip(target, 50)

    return { present: query ? `Searching the web for ${query}` : 'Searching the web', past: query ? `Searched the web for ${query}` : 'Searched the web' }
  }

  if (name === 'web_extract') {
    const page = clip(target.replace(/^https?:\/\/(www\.)?/i, ''), 50)

    return { present: page ? `Reading ${page}` : 'Reading a web page', past: page ? `Read ${page}` : 'Read a web page' }
  }

  if (name.startsWith('browser')) {
    // A tool that describes its step in words ("Open example.com on the bot screen") is shown as written; a bare
    // address is something that was browsed.
    if (/\s/.test(target.trim()) && /^[A-Z]/.test(target.trim())) {
      return { present: clip(target, 56), past: clip(target, 56) }
    }

    return { present: target ? `Browsing ${clip(target, 50)}` : 'Browsing', past: target ? `Browsed ${clip(target, 50)}` : 'Browsed' }
  }

  if (name === 'tool_search') {
    return { present: 'Looking through its tools', past: 'Looked through its tools' }
  }

  if (name === 'tool_describe') {
    return { present: 'Reading how its tools work', past: 'Read how its tools work' }
  }

  const dashboard = DASHBOARD_WORDS[name]

  if (dashboard) {
    return dashboard
  }

  if (name === 'computer_use') {
    return { present: 'Using the computer', past: 'Used the computer' }
  }

  if (name === 'message_agent') {
    const who = target ? target.charAt(0).toUpperCase() + target.slice(1) : 'a teammate'

    return { present: `Messaging ${who}`, past: `Messaged ${who}` }
  }

  if (name === 'clarify') {
    return { present: 'Asking you a question', past: 'Asked you a question' }
  }

  return { present: `Using ${step.name.replace(/_/g, ' ')}`, past: `Used ${step.name.replace(/_/g, ' ')}` }
}

/**
 * The step worked on the bot's own screen, so it can be watched there. `computer_use` always does. A browser step does only
 * when the bot's browser shows on the screen: Hermes runs it headless unless `browser.headed` is on, or it attaches to a Chrome
 * already open on the running screen (`tools/browser_tool_session.py`, 0.21.5). `browser_cdp` and `browser_dialog` drive
 * another browser at a configured address.
 */
export function usesScreen(step: StepLike, browserShows: boolean): boolean {
  const name = calledTool(step).name.toLowerCase()

  if (name === 'computer_use') {
    return true
  }

  return browserShows && name.startsWith('browser_') && name !== 'browser_cdp' && name !== 'browser_dialog'
}

/** The step that is waiting on a person to hand the screen back, if the run ended on one. */
export function waitingOnYou(steps: Step[]): Step | undefined {
  const last = steps.at(-1)

  return last?.humanHasControl ? last : undefined
}

export interface ActivitySummary {
  /** `running` shows the live step; `failed` is red; otherwise the run is folded to one line. */
  kind: 'running' | 'failed' | 'done'
  /** The one line: "Running docker compose pull", "Command failed · exit 1", "Ran 4 steps · 1m 12s". */
  title: string
  /** For `running`: the step to show with its elapsed time and last result line. */
  current?: Step
  /** Seconds the running step has been going (live) so the line can tick. */
  elapsedS?: number
  stepCount: number
}

/** Folds a run of steps into the single line the chat shows. */
/**
 * How long a run of steps took on the clock. A bot issues several tool calls at once and the server waits for the slowest, so adding up
 * each step's own time overstates it ("Ran 5 steps · 2m 36s" for a batch that took 1m 8s). Steps whose spans overlap count once; a
 * step with no start time (an older server) is added as it is.
 */
export function elapsedS(steps: Step[]): number {
  const spans: [number, number][] = []
  let unplaced = 0

  for (const step of steps) {
    if (step.durationS === undefined) {
      continue
    }

    if (step.startedAt === undefined) {
      unplaced += step.durationS
    } else {
      spans.push([step.startedAt, step.startedAt + step.durationS * 1000])
    }
  }

  spans.sort((a, b) => a[0] - b[0])
  let covered = 0
  let [from, to] = spans[0] ?? [0, 0]

  for (const [start, end] of spans.slice(1)) {
    if (start <= to) {
      to = Math.max(to, end)
    } else {
      covered += to - from
      ;[from, to] = [start, end]
    }
  }

  return (covered + (to - from)) / 1000 + unplaced
}

/**
 * `carriedOn`: the bot did more after this run in the same turn (wrote, ran more steps, or is still going), so a failure it
 * ended on was handled, not where things stopped.
 */
export function summarizeActivity(steps: Step[], now: number = Date.now(), carriedOn = false): ActivitySummary {
  const stepCount = steps.length
  const running = lastWhere(steps, step => step.state === 'running')

  if (running) {
    return {
      kind: 'running',
      title: wording(running).present,
      current: running,
      elapsedS: running.startedAt === undefined ? undefined : Math.max(0, (now - running.startedAt) / 1000),
      stepCount,
    }
  }

  // A run reads as failed only if the turn STOPPED on a failure: its last step failed and the bot did nothing after it.
  // One that went wrong and carried on (in this run, or after it) was handled: the bot's reply says what happened, and the
  // step is still marked in the list when you open it.
  const last = steps.at(-1)
  const failed = last?.state === 'failed' && !carriedOn ? last : undefined

  if (failed) {
    const command = failed.name === 'terminal' || failed.name === 'process'

    return { kind: 'failed', title: command && failed.exitCode !== undefined ? `Command failed · exit ${failed.exitCode}` : command ? 'Command failed' : `${wording(failed).past} failed`, stepCount }
  }

  const total = elapsedS(steps)
  const noun = stepCount === 1 ? 'step' : 'steps'
  const held = waitingOnYou(steps)

  if (held) {
    return { kind: 'done', title: 'Waiting for you to hand back the screen', stepCount }
  }

  const denied = steps.every(step => step.state === 'blocked')

  if (denied) {
    return { kind: 'done', title: stepCount === 1 ? `${wording(steps[0] as Step).past} · denied` : `${stepCount} ${noun} denied`, stepCount }
  }

  return { kind: 'done', title: `Ran ${stepCount} ${noun} · ${formatDuration(total)}`, stepCount }
}
