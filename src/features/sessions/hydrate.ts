import type { SessionResumeResult } from '../../lib/hermes/protocol.ts'
import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { historyWithOpenTurn, settleStaleSteps, turnIsChatter, turnIsStored } from '../transcript/history.ts'
import { routineDelivery } from '../transcript/injected.ts'
import { initialTranscript, reduceEvent, revealLastReply } from '../transcript/reduce.ts'
import type { Item, TranscriptState } from '../transcript/types.ts'
import type { BotSession } from './types.ts'

export function blankSession(profile: string): BotSession {
  return {
    profile,
    phase: 'idle',
    error: null,
    storedId: null,
    liveId: null,
    transcript: initialTranscript(),
    info: null,
    rows: [],
    hasOlder: false,
    loadingOlder: false,
  }
}

const startsTurn = (item: Item): boolean => item.kind === 'user' || item.kind === 'note' || item.kind === 'teammate'

function alreadyShown(items: Item[], partial: string): boolean {
  const wanted = partial.trim()
  const lastUser = items.map(startsTurn).lastIndexOf(true)

  if (items.at(-1)?.kind === 'activity') {
    return true
  }

  return items.slice(lastUser + 1).some(item => item.kind === 'assistant' && item.text.trim().startsWith(wanted))
}

/** Builds a UI transcript from stored rows and `session.resume` state. */
export function buildTranscript(
  rows: StoredMessage[],
  resume: Pick<SessionResumeResult, 'running' | 'inflight' | 'pending_approval' | 'pending_clarify'>,
): TranscriptState {
  const read = historyWithOpenTurn(rows)
  const runningIsLast = resume.running && turnIsStored(rows, resume.inflight?.user)
  let items = read.routineFrom !== null && !runningIsLast ? revealLastReply(read.items, read.routineFrom) : read.items

  if (!resume.running) {
    items = settleStaleSteps(items)
  }

  let transcript = initialTranscript(items)

  if (resume.running) {
    transcript = { ...transcript, running: true, phase: 'thinking' }
    const partial = resume.inflight?.assistant
    const betweenBots = turnIsChatter(rows, resume.inflight?.user)

    if (betweenBots) {
      const routineFrom = runningIsLast ? read.routineFrom : routineDelivery(resume.inflight?.user ?? '') !== null ? items.length : null
      transcript = { ...transcript, chatterFrom: items.length, routineFrom }
    }

    if (!betweenBots && partial?.trim() && !alreadyShown(items, partial)) {
      transcript = reduceEvent(transcript, { type: 'message.delta', payload: { text: partial } })
    }
  } else if (resume.inflight?.status === 'error' && resume.inflight.error && startsTurn(items.at(-1) as Item)) {
    transcript = reduceEvent(transcript, { type: 'error', payload: { message: resume.inflight.error } })
  }

  if (resume.pending_approval) {
    transcript = reduceEvent(transcript, { type: 'approval.request', payload: resume.pending_approval })
  }

  if (resume.pending_clarify) {
    transcript = reduceEvent(transcript, { type: 'clarify.request', payload: resume.pending_clarify })
  }

  return transcript
}
