import { imageOfResult } from '../../lib/hermes/media.ts'
import type { ToolResult } from '../../lib/hermes/protocol.ts'
import type { Step, StepState } from './types.ts'

const ANSWERS_WITH_EXIT_ONE = new Set(['grep', 'egrep', 'fgrep', 'rg', 'pgrep', 'diff', 'cmp', 'test', '[', 'which', 'pidof'])
const HUMAN_HAS_CONTROL = 'human_has_control'

/** Last non-empty line of tool output, for the quiet sub-line under a step. */
export function lastLine(text: string | undefined): string | undefined {
  if (!text) {
    return undefined
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const line = lines.at(-1)

  return line && line.length > 140 ? `${line.slice(0, 139)}…` : line
}

export function exitSetter(command: string): string {
  const bare = command.replace(/'[^']*'|"[^"]*"/g, '""')
  const last = bare.split(/;|&&|\|\||\||\n|\(/).map(part => part.trim()).filter(Boolean).at(-1) ?? ''
  const words = last.split(/\s+/).filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) && word !== 'sudo' && word !== 'time')

  return words[0] ?? ''
}

export function commandOf(step: Pick<Step, 'context' | 'args'>): string {
  const command = step.args?.command

  return typeof command === 'string' && command ? command : step.context
}

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

export function heldBy(text: string): { state: StepState; output?: string; line: string; humanHasControl: true } | null {
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

export function readResult(result: ToolResult | string | undefined): ReturnType<typeof readResultState> & { image?: string; diff?: string; file?: string } {
  const image = imageOfResult(result)
  const read = image ? { ...readResultState(result), image } : readResultState(result)
  const edit = editOfResult(result)

  return edit.diff || edit.file ? { ...read, ...edit } : read
}

export function contextFromArgs(args: Record<string, unknown> | undefined): string {
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
