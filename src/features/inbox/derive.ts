/**
 * The "Needs you" list and each bot's attention state, from three sources: prompts in chats the app
 * has open, approvals polled for sessions it has not opened, and the server's own `waiting` status.
 * Pure.
 */

import type { ActiveSessionRow, ApprovalChoice, ApprovalRequestPayload, ClarifyQuestion, ProfileRow } from '../../lib/hermes/protocol.ts'
import { botLastActive, deriveAttention, matchActiveToBots, strongestStatus, type Attention, type AttentionContext } from '../attention/derive.ts'
import type { BotSession } from '../sessions/store.ts'
import { pendingPrompts } from '../transcript/reduce.ts'

export type InboxKind = 'approval' | 'question' | 'secret' | 'sudo' | 'waiting'

export interface InboxEntry {
  /** Stable across refreshes, for list keys. */
  key: string
  profile: string
  kind: InboxKind
  requestId?: string
  /** The live session to answer on (absent for `waiting`, which has no details until the chat is opened). */
  liveId?: string
  /** One line for the list. */
  summary: string
  /** The command to approve. Sensitive: show it, never log or persist it. */
  command?: string
  choices?: ApprovalChoice[]
  /** For `question`: what is being asked. */
  questions?: ClarifyQuestion[]
  /** For `secret`: what it is for and the variable that will hold it. */
  prompt?: string
  envVar?: string
  /** Answerable right here, or the user must open the chat first. */
  inline: boolean
}

export interface InboxInput {
  roster: ProfileRow[]
  sessions: Record<string, BotSession>
  active: ActiveSessionRow[]
  /** `approval.pending` rows for sessions the app has not opened, keyed by live id. */
  polled: Record<string, ApprovalRequestPayload[]>
  knownLiveIds: Record<string, readonly string[]>
}

function choicesFor(row: ApprovalRequestPayload): ApprovalChoice[] {
  // `approval.pending` rows carry no `choices`, so build them from the allow flags.
  return row.choices?.length ? row.choices : ['once', ...(row.allow_session === false ? [] : (['session'] as const)), ...(row.allow_permanent === false ? [] : (['always'] as const)), 'deny']
}

export function deriveInbox(input: InboxInput): { entries: InboxEntry[]; byBot: Map<string, InboxEntry[]> } {
  const activeByBot = matchActiveToBots(input.roster, input.active, input.knownLiveIds)
  const entries: InboxEntry[] = []

  for (const bot of input.roster) {
    const session = input.sessions[bot.name]

    if (session?.phase === 'ready') {
      // An open chat knows exactly what it is waiting on.
      for (const prompt of pendingPrompts(session.transcript)) {
        entries.push({
          key: `${bot.name}:${prompt.requestId}`,
          profile: bot.name,
          kind: prompt.kind,
          requestId: prompt.requestId,
          liveId: session.liveId ?? undefined,
          summary: prompt.kind === 'approval' ? prompt.description : prompt.kind === 'question' ? (prompt.questions[0]?.question ?? 'A question') : prompt.kind === 'secret' ? prompt.prompt || 'A secret is needed' : 'A password is needed',
          command: prompt.kind === 'approval' ? prompt.command : undefined,
          choices: prompt.kind === 'approval' ? prompt.choices : undefined,
          questions: prompt.kind === 'question' ? prompt.questions : undefined,
          prompt: prompt.kind === 'secret' ? prompt.prompt : undefined,
          envVar: prompt.kind === 'secret' ? prompt.envVar : undefined,
          inline: true,
        })
      }

      continue
    }

    const rows = activeByBot.get(bot.name) ?? []
    let found = false

    for (const row of rows) {
      for (const approval of input.polled[row.id] ?? []) {
        found = true
        entries.push({
          key: `${bot.name}:${approval.request_id}`,
          profile: bot.name,
          kind: 'approval',
          requestId: approval.request_id,
          liveId: row.id,
          summary: approval.description,
          command: approval.command,
          choices: choicesFor(approval),
          inline: true,
        })
      }
    }

    // `waiting` is a clarify, sudo or secret prompt, which only a resumed chat can show.
    if (!found && strongestStatus(rows) === 'waiting') {
      entries.push({ key: `${bot.name}:waiting`, profile: bot.name, kind: 'waiting', summary: 'Waiting for your answer', inline: false })
    }
  }

  const activity = new Map(input.roster.map(bot => [bot.name, botLastActive(bot)]))
  entries.sort((a, b) => (activity.get(b.profile) ?? 0) - (activity.get(a.profile) ?? 0))

  const byBot = new Map<string, InboxEntry[]>()

  for (const entry of entries) {
    byBot.set(entry.profile, [...(byBot.get(entry.profile) ?? []), entry])
  }

  return { entries, byBot }
}

/** One bot's attention state, from its roster row, the inbox and the server's status list. */
export function attentionFor(
  bot: ProfileRow,
  input: { inbox: Map<string, InboxEntry[]>; activeByBot: Map<string, ActiveSessionRow[]>; /** When the chat last showed you something, if known, seconds. */ lastActive?: number },
  context: AttentionContext,
): Attention {
  const entries = input.inbox.get(bot.name) ?? []

  return deriveAttention(
    {
      // A `waiting` entry is the server's own status, which deriveAttention reads from activeStatus.
      hasPendingPrompt: entries.some(entry => entry.kind !== 'waiting'),
      activeStatus: strongestStatus(input.activeByBot.get(bot.name)),
      workerLastActive: bot.worker_session?.last_active,
      lastActive: input.lastActive ?? botLastActive(bot),
    },
    context,
  )
}
