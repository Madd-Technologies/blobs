import type { InboxEntry } from '@/features/inbox/derive'
import type { ClarifyAnswer, RespondResult } from '@/features/sessions/store'
import type { ApprovalChoice } from '@/lib/hermes/protocol'
import type { PromptAnswer } from '@/lib/hermes/server-requests'
import { requests } from '@/stores/connection'
import { inbox } from '@/stores/inbox'
import { sessions } from '@/stores/sessions'

/**
 * Answering an inbox entry. A chat the app has open answers through its own session, which also
 * updates its transcript; an approval on a session the app has not opened is answered by live id, and
 * a question, sudo or secret the server pushed is answered as the server request it is.
 */

function openIn(entry: InboxEntry): boolean {
  const session = sessions.store.getState().bots[entry.profile]

  return session?.phase === 'ready' && !!entry.liveId && session.liveId === entry.liveId
}

export async function answerApproval(entry: InboxEntry, choice: ApprovalChoice): Promise<RespondResult> {
  if (!entry.requestId) {
    return 'failed'
  }

  if (openIn(entry)) {
    return sessions.respondApproval(entry.profile, entry.requestId, choice)
  }

  if (!entry.liveId) {
    return 'failed'
  }

  try {
    const resolved = await inbox.respondApproval(entry.liveId, entry.requestId, choice)
    void inbox.refresh()

    return resolved ? 'answered' : 'expired'
  } catch {
    return 'failed'
  }
}

/**
 * A pushed prompt in a chat the app has not opened, answered as the server request it is: the server takes the answer
 * from any connection. The bridge learns the request first; it never logs what it sends.
 */
function answerPushed(entry: InboxEntry, answer: PromptAnswer): Promise<RespondResult> {
  const frame = entry.frame

  // Only the prompts the bridge knows: for any other method it tells the server "not supported", which withdraws it.
  if (!frame || !entry.liveId || !['clarify', 'secret', 'sudo'].includes(frame.method)) {
    return Promise.resolve('failed')
  }

  requests.ingest(entry.liveId, [frame])
  const outcome = requests.answer(frame.id, answer)

  if (outcome !== 'sent') {
    // Not a server request this socket can answer (gone already, or the connection dropped).
    return Promise.resolve(outcome === 'failed' ? 'failed' : 'expired')
  }

  inbox.dropPushed(frame.id)

  return Promise.resolve('answered')
}

export function answerQuestion(entry: InboxEntry, answers: ClarifyAnswer[]): Promise<RespondResult> {
  if (entry.requestId && openIn(entry)) {
    return sessions.respondClarify(entry.profile, entry.requestId, answers)
  }

  return answerPushed(entry, { kind: 'clarify', answers: answers.map(({ questionId, answer }) => ({ questionId, answer })) })
}

export function answerSecret(entry: InboxEntry, value: string): Promise<RespondResult> {
  return entry.requestId && openIn(entry) ? sessions.respondSecret(entry.profile, entry.requestId, value) : answerPushed(entry, { kind: 'value', value })
}

export function answerSudo(entry: InboxEntry, password: string): Promise<RespondResult> {
  return entry.requestId && openIn(entry) ? sessions.respondSudo(entry.profile, entry.requestId, password) : answerPushed(entry, { kind: 'value', value: password })
}
