import type { AttachmentChip } from '../../lib/hermes/attachments.ts'
import type { ApprovalChoice } from '../../lib/hermes/protocol.ts'
import type { Item, PromptItem, TranscriptState } from './types.ts'

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

export function withItems(state: TranscriptState, items: Item[], patch: Partial<TranscriptState> = {}): TranscriptState {
  return { ...state, ...patch, items }
}

export function settleChatter(items: Item[], from: number | null): Item[] {
  return from === null ? items : items.map((item, index) => (index >= from && !item.chatter ? { ...item, chatter: true as const } : item))
}

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

export function newId(state: TranscriptState, prefix: string): [string, number] {
  return [`${prefix}${state.nextId}`, state.nextId + 1]
}

export function closeStreaming(items: Item[]): Item[] {
  const last = items.at(-1)

  return last?.kind === 'assistant' && last.streaming ? [...items.slice(0, -1), { ...last, streaming: false }] : items
}

export function updatePrompt(items: Item[], requestId: string, patch: (item: PromptItem) => PromptItem): Item[] {
  return items.map(item =>
    (item.kind === 'approval' || item.kind === 'question' || item.kind === 'secret' || item.kind === 'sudo') && item.requestId === requestId ? patch(item) : item,
  )
}

export function appendUser(state: TranscriptState, text: string, now: number = Date.now(), attachments: AttachmentChip[] = []): TranscriptState {
  const [id, nextId] = newId(state, 'u-')

  return withItems(state, [...settleChatter(closeStreaming(state.items), state.chatterFrom), { kind: 'user', id, text, pending: true, ts: now, ...(attachments.length ? { attachments } : {}) }], { nextId, running: true, phase: 'thinking', lastTurn: null, chatterFrom: null, routineFrom: null, wake: false })
}

export function appendNote(state: TranscriptState, text: string, now: number = Date.now()): TranscriptState {
  if (state.running) {
    return state
  }

  const [id, nextId] = newId(state, 'n-')

  return withItems(state, [...state.items, { kind: 'note', id, text, ts: now }], { nextId })
}

export function startOutput(state: TranscriptState, command: string): TranscriptState {
  const [id, nextId] = newId(state, 'o-')

  return withItems(state, [...state.items, { kind: 'output', id, command, text: '', pending: true }], { nextId })
}

export function finishOutput(state: TranscriptState): TranscriptState {
  return state.items.some(item => item.kind === 'output' && item.pending) ? withItems(state, state.items.filter(item => !(item.kind === 'output' && item.pending))) : state
}

export function appendError(state: TranscriptState, message: string): TranscriptState {
  const [id, nextId] = newId(state, 'e-')

  return withItems(state, [...state.items, { kind: 'error', id, message }], { nextId })
}

export function appendOutput(state: TranscriptState, command: string, text: string, groups?: { title: string; names: string[] }[]): TranscriptState {
  const [id, nextId] = newId(state, 'o-')
  const shown = text.trim() || (groups?.length ? '' : '(no output)')

  return withItems(state, [...closeStreaming(state.items), { kind: 'output', id, command, text: shown, ...(groups?.length ? { groups } : {}) }], { nextId })
}

export function dropPendingUser(state: TranscriptState): TranscriptState {
  const at = state.items.map(item => item.kind === 'user' && item.pending).lastIndexOf(true)

  if (at < 0) {
    return state
  }

  return withItems(state, [...state.items.slice(0, at), ...state.items.slice(at + 1)], { running: false, phase: 'idle' })
}

export function failUser(state: TranscriptState, message: string): TranscriptState {
  const at = state.items.map(item => item.kind === 'user' && item.pending).lastIndexOf(true)
  const items = at >= 0 ? [...state.items.slice(0, at), ...state.items.slice(at + 1)] : state.items
  const [id, nextId] = newId(state, 'e-')

  return withItems(state, [...items, { kind: 'error', id, message }], { nextId, running: false, phase: 'idle' })
}

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

export function expirePrompt(state: TranscriptState, requestId: string): TranscriptState {
  return withItems(state, updatePrompt(state.items, requestId, item => (item.state === 'pending' ? { ...item, state: 'expired' } : item)))
}

export function pendingPrompts(state: TranscriptState): PromptItem[] {
  return state.items.filter((item): item is PromptItem => (item.kind === 'approval' || item.kind === 'question' || item.kind === 'secret' || item.kind === 'sudo') && item.state === 'pending')
}
