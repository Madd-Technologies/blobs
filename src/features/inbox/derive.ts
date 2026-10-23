/**
 * The "Needs you" list and each bot's attention state. Prompts in chats the app has open come from those chats. The rest
 * come from what the server pushes (hermes-bot-mobile 0.1.7+), or on a server without it from approvals polled for
 * sessions the app has not opened and the server's own `waiting` status. Pure.
 */

import type { ActiveSessionRow, ApprovalChoice, ApprovalRequestPayload, ClarifyQuestion, ProfileRow } from '../../lib/hermes/protocol.ts'
import { botLastActive, deriveAttention, matchActiveToBots, strongestStatus, type Attention, type AttentionContext } from '../attention/derive.ts'
import type { BotSession } from '../sessions/store.ts'
import { pendingPrompts } from '../transcript/reduce.ts'
import { isRoomChat, promptOf, type KanbanApproval, type PushedRequest } from './pushed.ts'

export type InboxKind = 'approval' | 'question' | 'secret' | 'sudo' | 'waiting'

export interface InboxEntry {
  /** Stable across refreshes, for list keys. */
  key: string
  profile: string
  kind: InboxKind
  requestId?: string
  /** The live session to answer on (absent for `waiting`, which has no details until the chat is opened). */
  liveId?: string
  /** The server request to answer through the request bridge, for a pushed prompt in a chat the app has not opened. */
  frame?: { id: string; method: string; params: Record<string, unknown> }
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
  /** A kanban worker's approval, answered through the plugin rather than a session. */
  kanban?: KanbanApproval
}

export interface InboxInput {
  roster: ProfileRow[]
  sessions: Record<string, BotSession>
  active: ActiveSessionRow[]
  /** `approval.pending` rows for sessions the app has not opened, keyed by live id. */
  polled: Record<string, ApprovalRequestPayload[]>
  /** What the server pushes as waiting on you, or null when it does not push it (then `polled` and `waiting` stand in). */
  pushed?: PushedRequest[] | null
  /** Approvals kanban workers wait on, each for the bot working the card. */
  kanban?: readonly KanbanApproval[]
  knownLiveIds: Record<string, readonly string[]>
}

function choicesFor(row: ApprovalRequestPayload): ApprovalChoice[] {
  // `approval.pending` rows carry no `choices`, so build them from the allow flags.
  return row.choices?.length ? row.choices : ['once', ...(row.allow_session === false ? [] : (['session'] as const)), ...(row.allow_permanent === false ? [] : (['always'] as const)), 'deny']
}

/** The bot a pushed prompt belongs to: the server says, else the session is matched the way the status list is. */
function ownerOf(request: PushedRequest, input: InboxInput, rosterNames: Set<string>, activeByBot: Map<string, ActiveSessionRow[]>): string | null {
  if (request.profile && rosterNames.has(request.profile)) {
    return request.profile
  }

  for (const [name, ids] of Object.entries(input.knownLiveIds)) {
    if (ids.includes(request.sessionId)) {
      return name
    }
  }

  for (const [name, rows] of activeByBot) {
    if (rows.some(row => row.id === request.sessionId)) {
      return name
    }
  }

  return null
}

export function deriveInbox(input: InboxInput): { entries: InboxEntry[]; byBot: Map<string, InboxEntry[]> } {
  const activeByBot = matchActiveToBots(input.roster, input.active, input.knownLiveIds)
  const entries: InboxEntry[] = []

  const pushed = input.pushed ?? null
  const rosterNames = new Set(input.roster.map(bot => bot.name))

  for (const bot of input.roster) {
    const session = input.sessions[bot.name]
    const openLiveId = session?.phase === 'ready' ? session.liveId : null

    if (pushed) {
      // Every chat of the bot but the one open here, which shows its own prompts (below). Room members' chats are the room's.
      for (const request of pushed) {
        if (request.sessionId === openLiveId || isRoomChat(request) || ownerOf(request, input, rosterNames, activeByBot) !== bot.name) {
          continue
        }

        const prompt = promptOf(request)
        entries.push({
          key: `${bot.name}:${prompt.requestId}`,
          profile: bot.name,
          kind: prompt.kind,
          requestId: prompt.requestId,
          liveId: request.sessionId,
          frame: { id: request.id, method: request.method, params: request.params },
          summary: prompt.summary,
          command: prompt.command,
          choices: prompt.choices,
          questions: prompt.questions,
          prompt: prompt.prompt,
          envVar: prompt.envVar,
          inline: prompt.kind !== 'waiting',
        })
      }
    }

    // A kanban worker's approval belongs to the bot working the card, wherever its chat is.
    for (const approval of input.kanban ?? []) {
      if (approval.profile !== bot.name) {
        continue
      }

      entries.push({
        key: `${bot.name}:kanban:${approval.id}`,
        profile: bot.name,
        kind: 'approval',
        requestId: approval.id,
        summary: approval.description || 'Needs your OK',
        command: approval.command,
        choices: approval.choices,
        inline: true,
        kanban: approval,
      })
    }

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

    if (pushed) {
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
  input: {
    inbox: Map<string, InboxEntry[]>
    activeByBot: Map<string, ActiveSessionRow[]>
    /** When the chat last showed you something, if known, seconds. */
    lastActive?: number
    /** Whether the chat's newest turn is one you started, if known (`VisibleActivity.lastTurnYours`). */
    turnByYou?: boolean
  },
  context: AttentionContext,
): Attention {
  const entries = input.inbox.get(bot.name) ?? []

  return deriveAttention(
    {
      // A `waiting` entry is the server's own status, which deriveAttention reads from activeStatus.
      hasPendingPrompt: entries.some(entry => entry.kind !== 'waiting'),
      activeStatus: strongestStatus(input.activeByBot.get(bot.name)),
      turnByYou: input.turnByYou,
      lastActive: input.lastActive ?? botLastActive(bot),
    },
    context,
  )
}
