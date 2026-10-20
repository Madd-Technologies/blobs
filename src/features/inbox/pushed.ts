/**
 * Needs you as the server pushes it (hermes-bot-mobile 0.1.7+): every prompt waiting on the person across the bots the
 * dashboard serves, sent over `/api/ws` as `plugin.hermes-bot-mobile.needs_you.changed` whenever it changes, and read
 * from `GET /api/plugins/hermes-bot-mobile/needs-you` when the app connects. With it the app no longer asks every busy
 * chat what it is waiting on. Pure.
 */

import type { ApprovalChoice, ClarifyQuestion } from '../../lib/hermes/protocol.ts'

export const NEEDS_YOU_EVENT = 'plugin.hermes-bot-mobile.needs_you.changed'
export const NEEDS_YOU_PATH = '/api/plugins/hermes-bot-mobile/needs-you'

/** One prompt waiting on the person, as the plugin sends it. */
export interface PushedRequest {
  /** The server request's id (`srq-…`): what the app answers through the request bridge. */
  id: string
  method: string
  sessionId: string
  /** The bot, from the session's profile home ('' when the server could not tell). */
  profile: string
  /** The chat's title: a group-room member's hidden chat is `Group: <room_id>`. */
  title: string
  createdAt: number
  /** The prompt as Hermes sent it, without `session_id`. An approval's command is already redacted. */
  params: Record<string, unknown>
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/**
 * The list from the route or the event, or null when the server cannot push it (`live: false`, an older plugin, or
 * something that is not the list): the app then keeps its own check.
 */
export function parseNeedsYou(body: unknown): PushedRequest[] | null {
  if (!body || typeof body !== 'object' || (body as { live?: unknown }).live !== true || !Array.isArray((body as { requests?: unknown }).requests)) {
    return null
  }

  return ((body as { requests: unknown[] }).requests ?? []).flatMap(entry => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const row = entry as Record<string, unknown>

    if (!text(row.id) || !text(row.method) || !text(row.session_id)) {
      return []
    }

    return [
      {
        id: text(row.id),
        method: text(row.method),
        sessionId: text(row.session_id),
        profile: text(row.profile),
        title: text(row.title),
        createdAt: typeof row.created_at === 'number' ? row.created_at : 0,
        params: row.params && typeof row.params === 'object' ? (row.params as Record<string, unknown>) : {},
      },
    ]
  })
}

/** A group room's member chat: its prompts are shown on the room, not on the bot. */
export const isRoomChat = (request: PushedRequest) => request.title.startsWith('Group: ')

/** What a pushed prompt needs from a Needs-you entry. */
export interface PushedPrompt {
  kind: 'approval' | 'question' | 'secret' | 'sudo' | 'waiting'
  /** The id the transcript and `approval.respond` use: an approval's own queue id, else the frame id. */
  requestId: string
  summary: string
  command?: string
  choices?: ApprovalChoice[]
  questions?: ClarifyQuestion[]
  prompt?: string
  envVar?: string
}

function questionsOf(params: Record<string, unknown>): ClarifyQuestion[] {
  if (Array.isArray(params.questions) && params.questions.length) {
    return params.questions as ClarifyQuestion[]
  }

  return text(params.question) ? [{ question: text(params.question), choices: Array.isArray(params.choices) ? (params.choices as string[]) : null, multi_select: params.multi_select === true }] : []
}

function choicesOf(params: Record<string, unknown>): ApprovalChoice[] {
  if (Array.isArray(params.choices) && params.choices.length) {
    return params.choices as ApprovalChoice[]
  }

  return ['once', ...(params.allow_session === false ? [] : (['session'] as const)), ...(params.allow_permanent === false ? [] : (['always'] as const)), 'deny']
}

/** The card a pushed prompt shows. Vault prompts are answered in the chat. */
export function promptOf(request: PushedRequest): PushedPrompt {
  const { params } = request

  switch (request.method) {
    case 'approval':
      return { kind: 'approval', requestId: text(params.request_id) || request.id, summary: text(params.description) || 'Needs your OK', command: text(params.command), choices: choicesOf(params) }

    case 'clarify': {
      const questions = questionsOf(params)

      return { kind: 'question', requestId: request.id, summary: questions[0]?.question || 'A question', questions }
    }

    case 'secret':
      return { kind: 'secret', requestId: request.id, summary: text(params.prompt) || 'A secret is needed', prompt: text(params.prompt), envVar: text(params.env_var) }

    case 'sudo':
      return { kind: 'sudo', requestId: request.id, summary: 'A password is needed' }

    default:
      return { kind: 'waiting', requestId: request.id, summary: 'Waiting for your answer' }
  }
}

// ── kanban workers' approvals ────────────────────────────────────────────────────────────────────

export const KANBAN_APPROVALS_PATH = '/api/plugins/hermes-bot-mobile/kanban-approvals'

/**
 * An approval a kanban worker waits on (hermes-bot-mobile 0.1.9+). The worker runs headless in its own process, so the
 * approval is not a session's prompt: it comes with Needs you under `kanban` and is answered through the plugin's route.
 */
export interface KanbanApproval {
  /** Hermes's request id: what the answer names. */
  id: string
  /** The bot working the card, whose chat shows it. */
  profile: string
  /** The chat to show it in: the one the card was created from, or '' for the bot's main chat. */
  chat: string
  task: { id: string; title: string; board: string; createdBy: string }
  /** Already redacted by Hermes. Sensitive: show it, never log or persist it. */
  command: string
  description: string
  choices: ApprovalChoice[]
  createdAt: number
}

/** The kanban workers' approvals in the route's body or the event; none from a plugin older than 0.1.9. */
export function parseKanban(body: unknown): KanbanApproval[] {
  const list = body && typeof body === 'object' ? (body as { kanban?: unknown }).kanban : null

  if (!Array.isArray(list)) {
    return []
  }

  return list.flatMap(entry => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const row = entry as Record<string, unknown>
    const task = row.task && typeof row.task === 'object' ? (row.task as Record<string, unknown>) : {}

    if (!text(row.id) || !text(row.profile)) {
      return []
    }

    return [
      {
        id: text(row.id),
        profile: text(row.profile),
        chat: text(row.chat),
        task: { id: text(task.id), title: text(task.title), board: text(task.board), createdBy: text(task.created_by) },
        command: text(row.command),
        description: text(row.description),
        choices: choicesOf(row),
        createdAt: typeof row.created_at === 'number' ? row.created_at : 0,
      },
    ]
  })
}

/**
 * The kanban approvals one chat shows: those of its bot that go to this chat (`ids`: the chat's own ids), or with no chat
 * of their own, to the bot's main chat when this is it.
 */
export function kanbanForChat(approvals: readonly KanbanApproval[], profile: string, ids: readonly (string | null | undefined)[], isMain: boolean): KanbanApproval[] {
  return approvals.filter(approval => approval.profile === profile && (approval.chat ? ids.includes(approval.chat) : isMain))
}

/**
 * The line under the card's title: which card it is for, and who asked for it when another bot did. `nameOf` gives a bot's
 * name, or null for something that isn't a bot (the dashboard, the CLI).
 */
export function kanbanAbout(approval: KanbanApproval, nameOf: (profile: string) => string | null): string {
  const asker = approval.task.createdBy && approval.task.createdBy !== approval.profile ? nameOf(approval.task.createdBy) : null
  const card = approval.task.title ? `For the task “${approval.task.title}”` : 'For a kanban task'

  return asker ? `${card}, which ${asker} asked for.` : `${card}.`
}
