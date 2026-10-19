/**
 * Needs you as the server pushes it (hermes-bot-mobile 0.1.6+): every prompt waiting on the person across the bots the
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
