/**
 * Prompts from a Hermes that asks them as JSON-RPC *requests* (0.21.5 and later).
 *
 * Older servers (0.21.0) announce a prompt with an event (`approval.request`, `clarify.request`, …) and
 * take the answer as an RPC (`approval.respond`, …). Newer ones send a request frame with an id like
 * `srq-1a2b3c` instead and expect the answer as the *response* to that frame. They only do so for a
 * client that said it can answer (`client.capabilities {server_requests: true}`); for any other client the
 * prompt is withdrawn at once ("the attached client cannot answer approval requests"), so a client that
 * never says so can see chat but can never answer an approval, a question, sudo or a secret.
 *
 * This module turns each such request into the event the transcript already understands, so the reducer
 * and the cards do not change, remembers which frame to answer, and turns `request.cancel` into the
 * existing "expired" events. Pure: the client is passed in.
 *
 * Wire shapes are from Hermes's own contract (`tui_gateway/contracts/server_requests.py`, v2026.9.24).
 */

import type { GatewayEvent } from './gateway-client.ts'
import type { ApprovalChoice } from './protocol.ts'

export interface ServerRequestFrame {
  id: string | number
  method: string
  params: Record<string, unknown>
}

/** What the bridge needs from the gateway client. */
export interface RequestTransport {
  onServerRequest(handler: (frame: ServerRequestFrame) => void): () => void
  onAny(handler: (event: GatewayEvent) => void): () => void
  /** Writes the response to a request. False if the socket is not open. */
  respond(id: string | number, result: unknown): boolean
  respondError(id: string | number, code: number, message: string): boolean
}

export const METHOD_NOT_FOUND = -32601

export type PromptMethod = 'approval' | 'clarify' | 'sudo' | 'secret'

const PROMPT_METHODS: ReadonlySet<string> = new Set<PromptMethod>(['approval', 'clarify', 'sudo', 'secret'])

export type PromptAnswer =
  | { kind: 'approval'; choice: ApprovalChoice; all?: boolean }
  | { kind: 'clarify'; answers: { questionId?: string; answer: string }[] }
  /** Sudo and secret: the value, or '' to skip. */
  | { kind: 'value'; value: string }

/** `sent`: answered as a server request. `unknown`: not one (answer it with the RPC). `failed`: socket closed. */
export type AnswerOutcome = 'sent' | 'unknown' | 'failed'

interface OpenRequest {
  frameId: string | number
  method: PromptMethod
  /** A batch of questions is answered as `{answers}` keyed by qid, a single question as `{answer}`. */
  batch: boolean
}

export interface RequestBridge {
  /** Gateway events, plus the prompt events made from server requests. Returns the unsubscribe function. */
  onEvent(handler: (event: GatewayEvent) => void): () => void
  /** Requests still open on a session, from `session.resume` / `session.events.since` (`open_requests`). */
  ingest(sessionId: string, snapshot: unknown): void
  answer(promptId: string, answer: PromptAnswer): AnswerOutcome
  /** Handle a request method that is not a chat prompt (e.g. `display.install.sudo`). */
  onRequest(method: string, handler: (frame: ServerRequestFrame) => void): () => void
  respond(id: string | number, result: unknown): boolean
  dispose(): void
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The prompt's id in the transcript: an approval keeps the server's own queue id, the rest use the frame id. */
function promptIdOf(method: PromptMethod, frame: ServerRequestFrame): string {
  return method === 'approval' ? text(frame.params.request_id) || String(frame.id) : String(frame.id)
}

/** The event the transcript understands for one prompt request. Never logs: the command is sensitive. */
function promptEvent(method: PromptMethod, frame: ServerRequestFrame, promptId: string): GatewayEvent {
  const { session_id: sessionId, ...params } = frame.params
  const base = { session_id: text(sessionId) || undefined }

  switch (method) {
    case 'approval':
      return { ...base, type: 'approval.request', payload: { ...params, request_id: promptId, command: text(params.command), description: text(params.description) } }

    case 'clarify':
      return { ...base, type: 'clarify.request', payload: { request_id: promptId, question: params.question, choices: params.choices, multi_select: params.multi_select, questions: params.questions } }

    case 'secret':
      return { ...base, type: 'secret.request', payload: { request_id: promptId, prompt: text(params.prompt), env_var: text(params.env_var) } }

    case 'sudo':
      return { ...base, type: 'sudo.request', payload: { request_id: promptId } }
  }
}

function resultOf(open: OpenRequest, answer: PromptAnswer): unknown {
  switch (answer.kind) {
    case 'approval':
      return { choice: answer.choice, ...(answer.all ? { all: true } : {}) }

    case 'value':
      return { value: answer.value }

    case 'clarify':
      if (open.batch) {
        const answers: Record<string, string> = {}

        for (const entry of answer.answers) {
          if (entry.questionId) {
            answers[entry.questionId] = entry.answer
          }
        }

        return { answers }
      }

      return { answer: answer.answers[0]?.answer ?? '' }
  }
}

export function createRequestBridge(transport: RequestTransport): RequestBridge {
  const open = new Map<string, OpenRequest>()
  const synthetic = new Set<(event: GatewayEvent) => void>()
  const custom = new Map<string, (frame: ServerRequestFrame) => void>()

  const emit = (event: GatewayEvent) => {
    for (const handler of [...synthetic]) {
      handler(event)
    }
  }

  function accept(frame: ServerRequestFrame): void {
    if (PROMPT_METHODS.has(frame.method)) {
      const method = frame.method as PromptMethod
      const promptId = promptIdOf(method, frame)
      open.set(promptId, { frameId: frame.id, method, batch: Array.isArray(frame.params.questions) && frame.params.questions.length > 0 })
      emit(promptEvent(method, frame, promptId))

      return
    }

    const handler = custom.get(frame.method)

    if (handler) {
      handler(frame)

      return
    }

    // Not something this client does: say so at once, so the agent does not wait out the full deadline.
    transport.respondError(frame.id, METHOD_NOT_FOUND, `${frame.method} is not supported by this client`)
  }

  const stopRequests = transport.onServerRequest(accept)

  // The server withdraws a request that timed out, was answered elsewhere, or was interrupted.
  const stopCancel = transport.onAny(event => {
    if (event.type !== ('request.cancel' as GatewayEvent['type'])) {
      return
    }

    const payload = (event.payload ?? {}) as { id?: unknown; method?: unknown }

    for (const [promptId, entry] of open) {
      if (String(entry.frameId) === String(payload.id)) {
        open.delete(promptId)
        emit({ type: `${entry.method}.expire` as GatewayEvent['type'], session_id: event.session_id, payload: { request_id: promptId } })
      }
    }
  })

  return {
    onEvent(handler) {
      const stopReal = transport.onAny(handler)
      synthetic.add(handler)

      return () => {
        stopReal()
        synthetic.delete(handler)
      }
    },

    ingest(sessionId, snapshot) {
      if (!Array.isArray(snapshot)) {
        return
      }

      for (const entry of snapshot as Partial<ServerRequestFrame>[]) {
        if (entry && (typeof entry.id === 'string' || typeof entry.id === 'number') && typeof entry.method === 'string') {
          accept({ id: entry.id, method: entry.method, params: { session_id: sessionId, ...(entry.params ?? {}) } })
        }
      }
    },

    answer(promptId, answer) {
      const entry = open.get(promptId)

      if (!entry) {
        return 'unknown'
      }

      if (!transport.respond(entry.frameId, resultOf(entry, answer))) {
        return 'failed'
      }

      open.delete(promptId)

      return 'sent'
    },

    onRequest(method, handler) {
      custom.set(method, handler)

      return () => {
        if (custom.get(method) === handler) {
          custom.delete(method)
        }
      }
    },

    respond: (id, result) => transport.respond(id, result),

    dispose() {
      stopRequests()
      stopCancel()
      synthetic.clear()
      open.clear()
    },
  }
}

/**
 * Tells the server this client answers server requests. Once per connection, before any chat is opened,
 * or the server withdraws every prompt. Resolves to the request methods the server may send; an older
 * server (no such method) resolves to none and keeps using events, so this is safe to call anywhere.
 */
export async function advertiseServerRequests(client: { request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> }): Promise<string[]> {
  try {
    const result = await client.request<{ server_requests?: string[] }>('client.capabilities', { server_requests: true }, 8000)

    return Array.isArray(result?.server_requests) ? result.server_requests : []
  } catch {
    return []
  }
}
