import type { InboxEntry } from '@/features/inbox/derive'
import type { ClarifyAnswer, RespondResult } from '@/features/sessions/store'
import type { ApprovalChoice } from '@/lib/hermes/protocol'
import { inbox } from '@/stores/inbox'
import { sessions } from '@/stores/sessions'

/**
 * Answering an inbox entry. A chat the app has open answers through its own session, which also
 * updates its transcript; an approval on a session the app has not opened is answered by live id.
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

export function answerQuestion(entry: InboxEntry, answers: ClarifyAnswer[]): Promise<RespondResult> {
  return entry.requestId && openIn(entry) ? sessions.respondClarify(entry.profile, entry.requestId, answers) : Promise.resolve('failed')
}

export function answerSecret(entry: InboxEntry, value: string): Promise<RespondResult> {
  return entry.requestId && openIn(entry) ? sessions.respondSecret(entry.profile, entry.requestId, value) : Promise.resolve('failed')
}

export function answerSudo(entry: InboxEntry, password: string): Promise<RespondResult> {
  return entry.requestId && openIn(entry) ? sessions.respondSudo(entry.profile, entry.requestId, password) : Promise.resolve('failed')
}
