/**
 * The transcript reducer: folds Hermes events into the item list the chat renders. Pure and
 * immutable: every function returns a new state and never mutates its input, so a store can call it
 * from an event handler and tests can replay recorded turns (docs/protocol-captures).
 */

import type { AttachmentChip } from '../../lib/hermes/attachments.ts'
import { imageOfResult } from '../../lib/hermes/media.ts'
import type { ApprovalChoice, ClarifyQuestion, ClarifyRequestPayload, HermesEvent, ToolResult } from '../../lib/hermes/protocol.ts'
import type { Item, PromptItem, Step, StepState, TranscriptState } from './types.ts'

export function initialTranscript(items: Item[] = []): TranscriptState {
  return {
    items,
    running: false,
    phase: 'idle',
    statusLine: null,
    title: null,
    usage: null,
    todos: null,
    lastTurn: null,
    chatterFrom: null,
    nextId: items.length + 1,
  }
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

function withItems(state: TranscriptState, items: Item[], patch: Partial<TranscriptState> = {}): TranscriptState {
  return { ...state, ...patch, items }
}

/** What was typed live during a turn between bots becomes flagged chatter once that turn is over. */
function settleChatter(items: Item[], from: number | null): Item[] {
  return from === null ? items : items.map((item, index) => (index >= from && !item.chatter ? { ...item, chatter: true as const } : item))
}

/**
 * Shows the last reply from `from` on (a routine's summary for the person), leaving the rest of its turn as chatter. Only a
 * reply nothing was run after is the summary: a turn cut off while the bot was still working (its last words were said on
 * the way to a tool) shows nothing more than its quiet line, as does one that ended without a reply.
 */
export function revealLastReply(items: Item[], from: number): Item[] {
  for (let i = items.length - 1; i >= from; i--) {
    const item = items[i]

    if (item?.kind === 'activity') {
      return items
    }

    if (item?.kind === 'assistant' && item.text.trim()) {
      const { chatter: _chatter, ...shown } = item

      return [...items.slice(0, i), shown, ...items.slice(i + 1)]
    }
  }

  return items
}

function newId(state: TranscriptState, prefix: string): [string, number] {
  return [`${prefix}${state.nextId}`, state.nextId + 1]
}

/** Stops the assistant bubble that is still being typed, because something else happened. */
/**
 * The server's `status.update` text as one quiet header line: no leading emoji (the design has none),
 * line breaks folded into spaces, and a length cap (a memory plugin sends whole paragraphs).
 */
export function quietStatus(text: string): string {
  // The wake-up Hermes sends when a background process ends is plumbing: its status text is a command line.
  if (/^\W*Background process finished\b/i.test(text.trim())) {
    return ''
  }

  const line = text
    .replace(/^[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\uFE0F\u200D\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()

  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line
}

/** Whitespace folded away, to compare two texts that differ only in line breaks and spacing. */
function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function closeStreaming(items: Item[]): Item[] {
  const last = items.at(-1)

  return last?.kind === 'assistant' && last.streaming ? [...items.slice(0, -1), { ...last, streaming: false }] : items
}

/** The last non-empty line of tool output, for the quiet sub-line under a step. */
export function lastLine(text: string | undefined): string | undefined {
  if (!text) {
    return undefined
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const line = lines.at(-1)

  return line && line.length > 140 ? `${line.slice(0, 139)}…` : line
}

/** Classifies a tool result and extracts what to show. */
/**
 * Programs whose exit status 1 is an answer ("no match", "not running", "differs"), not a failure: an agent
 * runs them to find out, so a red "Command failed" for `pgrep` finding nothing is a false alarm.
 */
const ANSWERS_WITH_EXIT_ONE = new Set(['grep', 'egrep', 'fgrep', 'rg', 'pgrep', 'diff', 'cmp', 'test', '[', 'which', 'pidof'])

/**
 * The program that set a command line's exit status: the first word of its last command (after `;`, `&&`,
 * `||`, `|`, a newline or an opening parenthesis), past any `VAR=value` prefixes and `sudo`. Quoted text is
 * blanked first so a `|` inside a quoted pattern does not split anything.
 */
export function exitSetter(command: string): string {
  const bare = command.replace(/'[^']*'|"[^"]*"/g, '""')
  const last = bare.split(/;|&&|\|\||\||\n|\(/).map(part => part.trim()).filter(Boolean).at(-1) ?? ''
  const words = last.split(/\s+/).filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && word !== 'sudo' && word !== 'time')

  return words[0] ?? ''
}

/** The command line of a step, as the tool was asked to run it. */
export function commandOf(step: Pick<Step, 'context' | 'args'>): string {
  const command = step.args?.command

  return typeof command === 'string' && command ? command : step.context
}

/**
 * Whether a non-zero exit is really a failure. Not when:
 *  - a signal ended it (Hermes reports those as negative, e.g. -15). A `pkill -f` that matches its own
 *    shell ends the shell by SIGTERM, having done exactly what was asked;
 *  - it was interrupted (130, "[Command interrupted]"): you stopped it, or a new message did;
 *  - it exited 1 and the command is a search or comparison (see above).
 * Anything else (including a tool error with no exit code) stays a failure.
 */
export function isRealFailure(read: { state: StepState; exitCode?: number }, command: string): boolean {
  if (read.state !== 'failed') {
    return false
  }

  const code = read.exitCode

  if (code === undefined) {
    return true
  }

  if (code < 0 || code === 130 || code === 143) {
    return false
  }

  return !(code === 1 && ANSWERS_WITH_EXIT_ONE.has(exitSetter(command)))
}

/** `computer_use` answers this code (as JSON text) while a person holds the bot's screen. */
const HUMAN_HAS_CONTROL = 'human_has_control'

function readResultState(result: ToolResult | string | undefined): { state: StepState; output?: string; line?: string; exitCode?: number; humanHasControl?: boolean; image?: string } {
  if (result === undefined) {
    return { state: 'done' }
  }

  if (typeof result === 'string') {
    const held = heldBy(result)

    if (held) {
      return held
    }

    return { state: 'done', output: result, line: lastLine(result) }
  }

  if ((result as { code?: unknown }).code === HUMAN_HAS_CONTROL) {
    return { state: 'blocked', output: typeof result.error === 'string' ? result.error : undefined, line: 'Waiting for you to hand back the screen', humanHasControl: true }
  }

  const output = typeof result.output === 'string' ? result.output : undefined
  const error = typeof result.error === 'string' && result.error ? result.error : undefined

  if (result.status === 'blocked') {
    return { state: 'blocked', output: error, line: 'Denied' }
  }

  const failed = !!error || (typeof result.exit_code === 'number' && result.exit_code !== 0)

  if (failed) {
    const code = typeof result.exit_code === 'number' && result.exit_code !== 0 ? `exit ${result.exit_code}` : undefined

    return { state: 'failed', output: output || error, line: lastLine(output) ?? lastLine(error) ?? code, exitCode: typeof result.exit_code === 'number' ? result.exit_code : undefined }
  }

  return { state: 'done', output, line: lastLine(output) }
}

/** What a tool's result says, with the picture it made (an `image_generate` result's file or URL), if any. */
export function readResult(result: ToolResult | string | undefined): ReturnType<typeof readResultState> & { image?: string; diff?: string; file?: string } {
  const image = imageOfResult(result)
  const read = image ? { ...readResultState(result), image } : readResultState(result)
  const edit = editOfResult(result)

  return edit.diff || edit.file ? { ...read, ...edit } : read
}

/**
 * What an edit did, from its result: `patch` returns the change as a unified `diff`; `write_file` and `patch` report the absolute path
 * they wrote (`resolved_path`, `files_modified`). A failed edit changed nothing, so it gives nothing.
 */
function editOfResult(result: ToolResult | string | undefined): { diff?: string; file?: string } {
  const value = typeof result === 'string' ? parseObject(result) : result

  if (!value || typeof value !== 'object' || (typeof value.error === 'string' && value.error)) {
    return {}
  }

  const record = value as Record<string, unknown>
  const diff = typeof record.diff === 'string' && record.diff.trim() ? record.diff : undefined
  const modified = Array.isArray(record.files_modified) ? record.files_modified.find((path): path is string => typeof path === 'string') : undefined
  const resolved = typeof record.resolved_path === 'string' ? record.resolved_path : undefined
  const file = [resolved, modified].find(path => path?.startsWith('/'))

  return { ...(diff ? { diff } : {}), ...(file ? { file } : {}) }
}

function parseObject(text: string): ToolResult | undefined {
  if (!text.trimStart().startsWith('{')) {
    return undefined
  }

  try {
    return JSON.parse(text) as ToolResult
  } catch {
    return undefined
  }
}

/** A tool result that is JSON text saying a person holds the screen: a step that is waiting on you, not a failure. */
function heldBy(text: string): { state: StepState; output?: string; line: string; humanHasControl: true } | null {
  if (!text.includes(HUMAN_HAS_CONTROL) || !text.trimStart().startsWith('{')) {
    return null
  }

  try {
    const parsed = JSON.parse(text) as { code?: unknown; error?: unknown }

    return parsed.code === HUMAN_HAS_CONTROL
      ? { state: 'blocked', output: typeof parsed.error === 'string' ? parsed.error : undefined, line: 'Waiting for you to hand back the screen', humanHasControl: true }
      : null
  } catch {
    return null
  }
}

/** A short description of what a tool call is acting on, when the server sent no `context`. */
function contextFromArgs(args: Record<string, unknown> | undefined): string {
  if (!args) {
    return ''
  }

  for (const key of ['command', 'path', 'file_path', 'query', 'url', 'name']) {
    const value = args[key]

    if (typeof value === 'string' && value) {
      return value
    }
  }

  return ''
}

function defaultChoices(allowSession: boolean | undefined, allowPermanent: boolean | undefined): ApprovalChoice[] {
  return ['once', ...(allowSession === false ? [] : (['session'] as const)), ...(allowPermanent === false ? [] : (['always'] as const)), 'deny']
}

function questionsOf(payload: ClarifyRequestPayload): ClarifyQuestion[] {
  if (payload.questions?.length) {
    return payload.questions
  }

  return [{ question: payload.question ?? '', choices: payload.choices, multi_select: payload.multi_select }]
}

function hasPrompt(items: Item[], requestId: string): boolean {
  return items.some(item => (item.kind === 'approval' || item.kind === 'question' || item.kind === 'secret' || item.kind === 'sudo') && item.requestId === requestId)
}

function updatePrompt(items: Item[], requestId: string, patch: (item: PromptItem) => PromptItem): Item[] {
  return items.map(item =>
    (item.kind === 'approval' || item.kind === 'question' || item.kind === 'secret' || item.kind === 'sudo') && item.requestId === requestId ? patch(item) : item,
  )
}

/** Every pending prompt becomes `to`. */
function settlePending(items: Item[], to: 'answered' | 'expired'): Item[] {
  return items.map(item =>
    (item.kind === 'approval' || item.kind === 'question' || item.kind === 'secret' || item.kind === 'sudo') && item.state === 'pending' ? { ...item, state: to } : item,
  )
}

function setStep(items: Item[], toolId: string, update: (step: Step) => Step): Item[] | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]

    if (item?.kind !== 'activity') {
      continue
    }

    const at = item.steps.findIndex(step => step.toolId === toolId)

    if (at >= 0) {
      const steps = item.steps.map((step, index) => (index === at ? update(step) : step))

      return [...items.slice(0, i), { ...item, steps }, ...items.slice(i + 1)]
    }
  }

  return null
}

/** Adds a step to the trailing activity run, or starts a new run. */
function pushStep(state: TranscriptState, items: Item[], step: Step): TranscriptState {
  const last = items.at(-1)

  if (last?.kind === 'activity') {
    return withItems(state, [...items.slice(0, -1), { ...last, steps: [...last.steps, step] }])
  }

  const [id, nextId] = newId(state, 'act-')

  return withItems(state, [...items, { kind: 'activity', id, steps: [step] }], { nextId })
}

// ── the reducer ──────────────────────────────────────────────────────────────────────────────────

/** Applies one server event. Events for other sessions must be filtered out by the caller. */
export function reduceEvent(state: TranscriptState, event: HermesEvent, now: number = Date.now()): TranscriptState {
  switch (event.type) {
    case 'message.start': {
      // The server has accepted the prompt: any optimistic user bubble is now real.
      const items = state.items.map(item => (item.kind === 'user' && item.pending ? { ...item, pending: false } : item))

      return withItems(state, items, { running: true, phase: 'thinking', lastTurn: null })
    }

    case 'message.delta': {
      const text = event.payload.text
      const last = state.items.at(-1)

      if (last?.kind === 'assistant' && last.streaming) {
        return withItems(state, [...state.items.slice(0, -1), { ...last, text: last.text + text }], { phase: 'writing' })
      }

      // A new bubble never starts with the blank lines models like to open with.
      const start = text.replace(/^\s+/, '')

      if (!start) {
        return state
      }

      const [id, nextId] = newId(state, 'a-')

      return withItems(state, [...state.items, { kind: 'assistant', id, text: start, streaming: true, ts: now }], { phase: 'writing', nextId, running: true })
    }

    case 'message.interim': {
      // Text the deltas already drew; only a message that was NOT streamed needs adding.
      if (event.payload.already_streamed || !event.payload.text.trim()) {
        return state
      }

      const [id, nextId] = newId(state, 'a-')

      return withItems(state, [...closeStreaming(state.items), { kind: 'assistant', id, text: event.payload.text.trim(), streaming: false, ts: now }], { nextId })
    }

    case 'thinking.delta':
      // Mostly empty ticks and a kaomoji: it only tells us the model is working.
      return state.phase === 'writing' || state.phase === 'tool' ? state : { ...state, phase: 'thinking', running: true }

    case 'reasoning.delta':
    case 'reasoning.available': {
      const text = event.payload.text
      const reasoning = text.trim()
      const lastAssistant = [...state.items].reverse().find(item => item.kind === 'assistant')

      // Some models have no separate reasoning, and the server echoes the reply: don't show it twice.
      if (!reasoning || (lastAssistant?.kind === 'assistant' && squash(lastAssistant.text) === squash(reasoning))) {
        return state
      }

      // Reasoning that turns up after the reply began goes in front of the bubble still streaming. That
      // bubble has to stay last: the next deltas and the final text look for it there, and a reasoning
      // item after it made the whole reply appear twice.
      const last = state.items.at(-1)
      const at = last?.kind === 'assistant' && last.streaming ? state.items.length - 1 : state.items.length
      const before = state.items[at - 1]

      if (before?.kind === 'thinking') {
        const next = event.type === 'reasoning.delta' ? before.text + text : text

        return withItems(state, [...state.items.slice(0, at - 1), { ...before, text: next }, ...state.items.slice(at)])
      }

      const [id, nextId] = newId(state, 'th-')

      return withItems(state, [...state.items.slice(0, at), { kind: 'thinking', id, text }, ...state.items.slice(at)], { nextId })
    }

    case 'status.update':
      return { ...state, statusLine: quietStatus(event.payload.text) || null }

    case 'tool.generating':
      return withItems(state, closeStreaming(state.items), { phase: 'tool', running: true })

    case 'tool.start': {
      const { tool_id: toolId, name, context, args } = event.payload
      const items = closeStreaming(state.items)

      // A repeated start (replay) refreshes the step instead of duplicating it.
      const refreshed = setStep(items, toolId, step => ({ ...step, name, args: args ?? step.args }))

      if (refreshed) {
        return withItems(state, refreshed, { phase: 'tool' })
      }

      const step: Step = { toolId, name, context: context ?? contextFromArgs(args), state: 'running', args, startedAt: now }

      return { ...pushStep(state, items, step), phase: 'tool', running: true }
    }

    case 'tool.progress': {
      const { tool_id: toolId, text } = event.payload

      if (!toolId || typeof text !== 'string') {
        return state
      }

      const items = setStep(state.items, toolId, step => ({ ...step, resultLine: lastLine(text) ?? step.resultLine }))

      return items ? withItems(state, items) : state
    }

    case 'tool.complete': {
      const { tool_id: toolId, name, args, duration_s: durationS, result } = event.payload
      const read = readResult(result)
      const finish = (step: Step): Step => ({
        ...step,
        // A non-zero exit that is only an answer (or a signal) is a finished step, with its exit code kept.
        state: read.state === 'failed' && !isRealFailure(read, commandOf({ context: step.context, args: step.args ?? args })) ? 'done' : read.state,
        durationS,
        output: read.output ?? step.output,
        resultLine: read.line ?? step.resultLine,
        exitCode: read.exitCode ?? step.exitCode,
        ...(read.humanHasControl ? { humanHasControl: true } : {}),
        ...(read.image && (step.name === 'image_generate' || name === 'image_generate') ? { image: read.image } : {}),
        ...(read.diff || event.payload.inline_diff ? { diff: read.diff ?? event.payload.inline_diff } : {}),
        ...(read.file ? { file: read.file } : {}),
      })
      // The tool ran, so any approval it was waiting on has been answered (maybe on another device).
      const base = settlePending(state.items, 'answered').map(item => (item.kind === 'approval' && item.state === 'answered' && !item.choice ? { ...item, choice: read.state === 'blocked' ? ('deny' as const) : ('once' as const) } : item))
      const updated = setStep(base, toolId, finish)

      if (updated) {
        return withItems(state, updated, { phase: 'thinking' })
      }

      // Complete without a start (resumed mid-turn): show it as a finished step.
      const step = finish({ toolId, name, context: contextFromArgs(args), state: 'done', args })

      return { ...pushStep(state, closeStreaming(base), step), phase: 'thinking' }
    }

    case 'todo.updated':
      return { ...state, todos: event.payload.todos ?? null }

    case 'approval.request': {
      const p = event.payload

      if (hasPrompt(state.items, p.request_id)) {
        return state
      }

      const [id, nextId] = newId(state, 'p-')
      const item: Item = {
        kind: 'approval',
        id,
        requestId: p.request_id,
        command: p.command,
        description: p.description,
        choices: p.choices?.length ? p.choices : defaultChoices(p.allow_session, p.allow_permanent),
        state: 'pending',
      }

      return withItems(state, [...closeStreaming(state.items), item], { nextId, phase: 'tool', running: true })
    }

    case 'clarify.request': {
      if (hasPrompt(state.items, event.payload.request_id)) {
        return state
      }

      const [id, nextId] = newId(state, 'p-')
      const item: Item = { kind: 'question', id, requestId: event.payload.request_id, questions: questionsOf(event.payload), state: 'pending' }

      return withItems(state, [...closeStreaming(state.items), item], { nextId, running: true })
    }

    case 'secret.request': {
      if (hasPrompt(state.items, event.payload.request_id)) {
        return state
      }

      const [id, nextId] = newId(state, 'p-')
      const item: Item = { kind: 'secret', id, requestId: event.payload.request_id, prompt: event.payload.prompt ?? '', envVar: event.payload.env_var ?? '', state: 'pending' }

      return withItems(state, [...closeStreaming(state.items), item], { nextId, running: true })
    }

    case 'sudo.request': {
      if (hasPrompt(state.items, event.payload.request_id)) {
        return state
      }

      const [id, nextId] = newId(state, 'p-')

      return withItems(state, [...closeStreaming(state.items), { kind: 'sudo', id, requestId: event.payload.request_id, state: 'pending' }], { nextId, running: true })
    }

    case 'approval.expire':
    case 'clarify.expire':
    case 'secret.expire':
    case 'sudo.expire':
      return withItems(state, updatePrompt(state.items, event.payload.request_id, item => (item.state === 'pending' ? { ...item, state: 'expired' } : item)))

    case 'message.complete': {
      const { text, status, error, usage } = event.payload
      let items = closeStreaming(state.items)
      const finalText = text?.trim() ?? ''

      if (status === 'error') {
        // The server puts the readable failure in `error` (and echoes it as `text`).
        const message = error || finalText || 'Something went wrong'
        const last = items.at(-1)

        if (!(last?.kind === 'error' && last.message === message)) {
          const [id, nextId] = newId(state, 'e-')
          items = [...items, { kind: 'error', id, message }]
          state = { ...state, nextId }
        }
      } else {
        // The authoritative final reply replaces the last bubble of this turn; if the reply never
        // streamed, it becomes a new bubble. Earlier segments (before tool calls) are left alone.
        const lastIndex = items.length - 1
        const last = items[lastIndex]

        if (last?.kind === 'assistant') {
          items = [...items.slice(0, lastIndex), { ...last, text: finalText || last.text, streaming: false, status }]
        } else if (finalText) {
          const [id, nextId] = newId(state, 'a-')
          items = [...items, { kind: 'assistant', id, text: finalText, streaming: false, status, ts: now }]
          state = { ...state, nextId }
        } else if (status === 'interrupted') {
          // Stopped before anything was written: say so, or the chat just ends after your message.
          const [id, nextId] = newId(state, 's-')
          items = [...items, { kind: 'stopped', id }]
          state = { ...state, nextId }
        }
      }

      // Nothing can still be waiting on the user once the turn is over.
      items = settlePending(items, 'expired')
      items = settleChatter(items, state.chatterFrom)

      // A routine's turn is over: its last reply is what the bot tells the person about it.
      if (state.routineFrom != null) {
        items = revealLastReply(items, state.routineFrom)
      }

      return withItems(state, items, { running: false, phase: 'idle', statusLine: null, lastTurn: status, usage: usage ?? state.usage, chatterFrom: null, routineFrom: null })
    }

    case 'session.info': {
      const running = event.payload.running

      if (typeof running !== 'boolean') {
        return state
      }

      return running ? { ...state, running: true } : { ...state, running: false, phase: 'idle', statusLine: null }
    }

    case 'session.title':
      return { ...state, title: event.payload.title }

    case 'session.usage':
      return { ...state, usage: event.payload.usage }

    case 'error': {
      const last = state.items.at(-1)

      if (last?.kind === 'error' && last.message === event.payload.message) {
        return state
      }

      const [id, nextId] = newId(state, 'e-')

      return withItems(state, [...closeStreaming(state.items), { kind: 'error', id, message: event.payload.message }], { nextId })
    }

    default:
      return state
  }
}

// ── local actions ────────────────────────────────────────────────────────────────────────────────

/** Shows the user's message at once, before the server has acknowledged it. */
export function appendUser(state: TranscriptState, text: string, now: number = Date.now(), attachments: AttachmentChip[] = []): TranscriptState {
  const [id, nextId] = newId(state, 'u-')

  return withItems(state, [...settleChatter(closeStreaming(state.items), state.chatterFrom), { kind: 'user', id, text, pending: true, ts: now, ...(attachments.length ? { attachments } : {}) }], { nextId, running: true, phase: 'thinking', lastTurn: null, chatterFrom: null, routineFrom: null })
}

/** A command is running on the server and has not answered yet: a quiet "Running…" line under its name. */
export function startOutput(state: TranscriptState, command: string): TranscriptState {
  const [id, nextId] = newId(state, 'o-')

  return withItems(state, [...state.items, { kind: 'output', id, command, text: '', pending: true }], { nextId })
}

/** The command answered (or failed): the "Running…" line goes, and whatever it said is added after it. */
export function finishOutput(state: TranscriptState): TranscriptState {
  return state.items.some(item => item.kind === 'output' && item.pending) ? withItems(state, state.items.filter(item => !(item.kind === 'output' && item.pending))) : state
}

/** Something went wrong with an action that is not a turn (a command): say so in the chat without touching the turn. */
export function appendError(state: TranscriptState, message: string): TranscriptState {
  const [id, nextId] = newId(state, 'e-')

  return withItems(state, [...state.items, { kind: 'error', id, message }], { nextId })
}

/** What a slash command printed, in the chat where it was run. The server does not keep it, so a reload drops it. */
export function appendOutput(state: TranscriptState, command: string, text: string, groups?: { title: string; names: string[] }[]): TranscriptState {
  const [id, nextId] = newId(state, 'o-')
  const shown = text.trim() || (groups?.length ? '' : '(no output)')

  return withItems(state, [...closeStreaming(state.items), { kind: 'output', id, command, text: shown, ...(groups?.length ? { groups } : {}) }], { nextId })
}

/** Removes the optimistic user bubble without saying anything (the send is about to be retried). */
export function dropPendingUser(state: TranscriptState): TranscriptState {
  const at = state.items.map(item => item.kind === 'user' && item.pending).lastIndexOf(true)

  if (at < 0) {
    return state
  }

  return withItems(state, [...state.items.slice(0, at), ...state.items.slice(at + 1)], { running: false, phase: 'idle' })
}

/** The send failed: drop the optimistic bubble and say why. */
export function failUser(state: TranscriptState, message: string): TranscriptState {
  const at = state.items.map(item => item.kind === 'user' && item.pending).lastIndexOf(true)
  const items = at >= 0 ? [...state.items.slice(0, at), ...state.items.slice(at + 1)] : state.items
  const [id, nextId] = newId(state, 'e-')

  return withItems(state, [...items, { kind: 'error', id, message }], { nextId, running: false, phase: 'idle' })
}

/** Records that the user answered a prompt on this device. */
export function answerPrompt(state: TranscriptState, requestId: string, answer: { choice?: ApprovalChoice; text?: string }): TranscriptState {
  return withItems(
    state,
    updatePrompt(state.items, requestId, item => {
      if (item.state !== 'pending') {
        return item
      }

      if (item.kind === 'approval') {
        return { ...item, state: 'answered', choice: answer.choice ?? 'once' }
      }

      if (item.kind === 'question') {
        return { ...item, state: 'answered', answer: answer.text }
      }

      return { ...item, state: 'answered' }
    }),
  )
}

/** Marks a prompt as no longer answerable (the server said it already resolved). */
export function expirePrompt(state: TranscriptState, requestId: string): TranscriptState {
  return withItems(state, updatePrompt(state.items, requestId, item => (item.state === 'pending' ? { ...item, state: 'expired' } : item)))
}

export function pendingPrompts(state: TranscriptState): PromptItem[] {
  return state.items.filter((item): item is PromptItem => (item.kind === 'approval' || item.kind === 'question' || item.kind === 'secret' || item.kind === 'sudo') && item.state === 'pending')
}
