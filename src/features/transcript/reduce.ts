import type { ApprovalChoice, ClarifyQuestion, ClarifyRequestPayload, HermesEvent } from '../../lib/hermes/protocol.ts'
import {
  answerPrompt,
  appendError,
  appendNote,
  appendOutput,
  appendUser,
  closeStreaming,
  dropPendingUser,
  expirePrompt,
  failUser,
  finishOutput,
  initialTranscript,
  newId,
  pendingPrompts,
  revealLastReply,
  settleChatter,
  startOutput,
  updatePrompt,
  withItems,
} from './actions.ts'
import { isHelpersResult } from './injected.ts'
import { followsWorkOf, jobIdOfResult, jobOfResult, withOutput, withSubagent } from './jobs.ts'
import { commandOf, contextFromArgs, exitSetter, isRealFailure, lastLine, readResult } from './toolResult.ts'
import type { Item, Job, Step, TranscriptState } from './types.ts'

export {
  answerPrompt,
  appendError,
  appendNote,
  appendOutput,
  appendUser,
  commandOf,
  dropPendingUser,
  exitSetter,
  expirePrompt,
  failUser,
  finishOutput,
  initialTranscript,
  isRealFailure,
  lastLine,
  pendingPrompts,
  readResult,
  revealLastReply,
  startOutput,
}

export function quietStatus(text: string): string {
  if (/^\W*(Background process finished|Subagent Tasks? (Completed|Incomplete|Failed|Cancelled|Interrupted|Timed Out|Stalled|Unknown|Finished with Issues))\b/i.test(text.trim())) {
    return ''
  }

  const line = text
    .replace(/^[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\uFE0F\u200D\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()

  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
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

function pushStep(state: TranscriptState, items: Item[], step: Step): TranscriptState {
  const last = items.at(-1)

  if (last?.kind === 'activity') {
    return withItems(state, [...items.slice(0, -1), { ...last, steps: [...last.steps, step] }])
  }

  const [id, nextId] = newId(state, 'act-')

  return withItems(state, [...items, { kind: 'activity', id, steps: [step] }], { nextId })
}

/** Applies one server event. Events for other sessions must be filtered out by the caller. */
export function reduceEvent(state: TranscriptState, event: HermesEvent, now: number = Date.now()): TranscriptState {
  switch (event.type) {
    case 'message.start': {
      const items = state.items.map(item => (item.kind === 'user' && item.pending ? { ...item, pending: false } : item))

      return withItems(state, items, { running: true, phase: 'thinking', lastTurn: null })
    }

    case 'message.delta': {
      const text = event.payload.text
      const last = state.items.at(-1)

      if (last?.kind === 'assistant' && last.streaming) {
        return withItems(state, [...state.items.slice(0, -1), { ...last, text: last.text + text }], { phase: 'writing' })
      }

      const start = text.replace(/^\s+/, '')

      if (!start) {
        return state
      }

      const [id, nextId] = newId(state, 'a-')

      return withItems(state, [...state.items, { kind: 'assistant', id, text: start, streaming: true, ts: now }], { phase: 'writing', nextId, running: true })
    }

    case 'message.interim': {
      if (event.payload.already_streamed || !event.payload.text.trim()) {
        return state
      }

      const [id, nextId] = newId(state, 'a-')

      return withItems(state, [...closeStreaming(state.items), { kind: 'assistant', id, text: event.payload.text.trim(), streaming: false, ts: now }], { nextId })
    }

    case 'thinking.delta':
      return state.phase === 'writing' || state.phase === 'tool' ? state : { ...state, phase: 'thinking', running: true }

    case 'reasoning.delta':
    case 'reasoning.available': {
      const text = event.payload.text
      const reasoning = text.trim()
      const lastAssistant = [...state.items].reverse().find(item => item.kind === 'assistant')

      if (!reasoning || (lastAssistant?.kind === 'assistant' && squash(lastAssistant.text) === squash(reasoning))) {
        return state
      }

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
      if (event.payload.kind === 'process' && isHelpersResult(event.payload.text)) {
        return { ...state, wake: true, statusLine: null }
      }

      if (state.liveWork && event.payload.kind === 'process') {
        return state
      }

      return { ...state, statusLine: quietStatus(event.payload.text) || null }

    case 'tool.generating':
      return withItems(state, closeStreaming(state.items), { phase: 'tool', running: true })

    case 'tool.start': {
      const { tool_id: toolId, name, context, args } = event.payload
      const items = closeStreaming(state.items)
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
      const jobId = followsWorkOf(name, state) ? jobIdOfResult(name, result) : undefined
      let job: Job | undefined
      const finish = (step: Step): Step => ({
        ...step,
        state: read.state === 'failed' && !isRealFailure(read, commandOf({ context: step.context, args: step.args ?? args })) ? 'done' : read.state,
        durationS,
        output: read.output ?? step.output,
        resultLine: read.line ?? step.resultLine,
        exitCode: read.exitCode ?? step.exitCode,
        ...(read.humanHasControl ? { humanHasControl: true } : {}),
        ...(read.image && (step.name === 'image_generate' || name === 'image_generate') ? { image: read.image } : {}),
        ...(read.diff || event.payload.inline_diff ? { diff: read.diff ?? event.payload.inline_diff } : {}),
        ...(read.file ? { file: read.file } : {}),
        ...(jobId ? { jobId } : {}),
      })
      const follow = (step: Step): Step => {
        const done = finish(step)
        job = jobId ? jobOfResult({ ...done, name }, result, now, state.jobs?.[jobId]) : undefined

        return done
      }
      const jobs = (): Partial<TranscriptState> => (job ? { jobs: { ...state.jobs, [job.id]: job } } : {})
      const base = settlePending(state.items, 'answered').map(item => (item.kind === 'approval' && item.state === 'answered' && !item.choice ? { ...item, choice: read.state === 'blocked' ? ('deny' as const) : ('once' as const) } : item))
      const updated = setStep(base, toolId, follow)

      if (updated) {
        return withItems(state, updated, { phase: 'thinking', ...jobs() })
      }

      const step = follow({ toolId, name, context: contextFromArgs(args), state: 'done', args })

      return { ...pushStep(state, closeStreaming(base), step), phase: 'thinking', ...jobs() }
    }

    case 'agent.terminal.output': {
      const { process_id: id, chunk } = event.payload

      if (!state.liveWork || !id || typeof chunk !== 'string') {
        return state
      }

      const job: Job = state.jobs?.[id] ?? { id, kind: 'command', label: '', state: 'running', startedAt: now }

      return { ...state, jobs: { ...state.jobs, [id]: withOutput(job, chunk) } }
    }

    case 'subagent.spawn_requested':
    case 'subagent.start':
    case 'subagent.progress':
    case 'subagent.tool':
    case 'subagent.complete': {
      const id = event.payload.delegation_id ?? event.payload.subagent_id

      if (!(state.liveWork || state.liveHelpers) || !id) {
        return state
      }

      const job = withSubagent(state.jobs?.[id], event.type, event.payload, now)

      return job && job !== state.jobs?.[id] ? { ...state, jobs: { ...state.jobs, [id]: job } } : state
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
        const message = error || finalText || 'Something went wrong'
        const last = items.at(-1)

        if (!(last?.kind === 'error' && last.message === message)) {
          const [id, nextId] = newId(state, 'e-')
          items = [...items, { kind: 'error', id, message }]
          state = { ...state, nextId }
        }
      } else {
        const lastIndex = items.length - 1
        const last = items[lastIndex]

        if (last?.kind === 'assistant') {
          items = [...items.slice(0, lastIndex), { ...last, text: finalText || last.text, streaming: false, status }]
        } else if (finalText) {
          const [id, nextId] = newId(state, 'a-')
          items = [...items, { kind: 'assistant', id, text: finalText, streaming: false, status, ts: now }]
          state = { ...state, nextId }
        } else if (status === 'interrupted') {
          const [id, nextId] = newId(state, 's-')
          items = [...items, { kind: 'stopped', id }]
          state = { ...state, nextId }
        }
      }

      items = settlePending(items, 'expired')
      items = settleChatter(items, state.chatterFrom)

      if (state.routineFrom != null) {
        items = revealLastReply(items, state.routineFrom)
      }

      return withItems(state, items, { running: false, phase: 'idle', statusLine: null, lastTurn: status, usage: usage ?? state.usage, chatterFrom: null, routineFrom: null, wake: false })
    }

    case 'session.info': {
      const running = event.payload.running

      if (typeof running !== 'boolean') {
        return state
      }

      return running ? { ...state, running: true } : { ...state, running: false, phase: 'idle', statusLine: null, wake: false }
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
