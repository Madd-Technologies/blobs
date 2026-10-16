/**
 * Typed JSON-RPC calls for the Hermes gateway. `call(client, 'method', params)` checks the params
 * and result against {@link RpcMethods}; add a method here when a batch first uses it.
 * Pure: takes any client with the vendored client's `request` shape.
 */

import { JsonRpcGatewayError } from './gateway-client.ts'
import type {
  ActiveSessionRow,
  DisplayLease,
  DisplayObserveResult,
  DisplayStatus,
  DisplayThumbnailResult,
  ApprovalChoice,
  ApprovalRequestPayload,
  PromptSubmitResult,
  RoomDriverStatus,
  RoomEvent,
  RoomLogPage,
  RoomMember,
  AttachedFileResult,
  CommandsCatalog,
  CommandDispatch,
  AttachedImageResult,
  AttachedPdfResult,
  HostedRoom,
  ModelOptions,
  ProcessListRow,
  ProfileConfigureParams,
  ProfileConfigureResult,
  ProfileCreateParams,
  ProfileCreateResult,
  ProfileDescription,
  ProfilesListResult,
  SessionCreateResult,
  SessionInfo,
  SessionResumeResult,
  SubagentListRow,
} from './protocol.ts'

/** The slice of the gateway client that `call` needs. */
export interface RpcClient {
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal): Promise<T>
}

export interface RpcMethods {
  ping: { params: Record<never, never>; result: { pong: boolean } }
  'gateway.capabilities': { params: Record<never, never>; result: { per_session_exclusive_submit?: boolean } }

  'profiles.list': { params: { include_sessions?: boolean }; result: ProfilesListResult }
  /** Scoped to `profile` when given; `explicit_only` hides providers that only have ambient credentials. */
  'model.options': { params: { profile?: string; session_id?: string; explicit_only?: boolean; refresh?: boolean }; result: ModelOptions }
  /** Re-reads ~/.hermes/.env into the server process (new keys work on the next call; built agents keep their credentials). */
  'reload.env': { params: Record<never, never>; result: { updated: number } }
  'profiles.describe': { params: { name: string }; result: ProfileDescription }
  'profiles.configure': { params: ProfileConfigureParams; result: ProfileConfigureResult }
  'profiles.create': { params: ProfileCreateParams; result: ProfileCreateResult }

  'session.create': {
    params: {
      profile?: string
      title?: string
      hidden?: boolean
      /** Pins the model for this session only; with `provider` it is also what the agent is built with. */
      model?: string
      provider?: string
      /** Bot Chat sessions follow the profile's config instead of a per-session pin. */
      follow_profile_config?: boolean
      cwd?: string
    }
    result: SessionCreateResult
  }
  'session.resume': {
    params: { session_id: string; profile?: string; omit_messages?: boolean }
    result: SessionResumeResult
  }
  'session.list': {
    params: { profile?: string; title?: string; include_hidden?: boolean; limit?: number }
    result: { sessions: { id: string; resolved_id?: string; title?: string; preview?: string; started_at?: number; message_count?: number; source?: string }[] }
  }
  'session.title': { params: { session_id: string; title: string }; result: { title?: string } }
  'session.interrupt': { params: { session_id: string }; result: { status: string } }
  'session.close': { params: { session_id: string }; result: Record<string, unknown> }
  /** `session_id` is the STORED id; the server refuses while the session is live here (close it first). */
  'session.delete': { params: { session_id: string; profile?: string }; result: { deleted: string } }
  'session.active_list': { params: Record<never, never>; result: { sessions: ActiveSessionRow[] } }
  'session.usage': { params: { session_id: string }; result: Record<string, number> }

  /** Queues an image (base64, up to 25 MB) for the session's next `prompt.submit`. */
  'image.attach_bytes': { params: { session_id: string; content_base64: string; filename?: string }; result: AttachedImageResult }
  /** Renders a PDF's pages to images (needs `pdftoppm` on the server: 5028 when it is missing). */
  'pdf.attach': { params: { session_id: string; content_base64: string; filename?: string }; result: AttachedPdfResult }
  /** Stages any other file in the session's workspace; `ref_text` goes into the message. */
  'file.attach': { params: { session_id: string; name?: string; data_url: string }; result: AttachedFileResult }
  'prompt.submit': { params: { session_id: string; text: string }; result: PromptSubmitResult }

  /** Slash commands and skills for the session (its profile and workspace decide which skills exist). */
  'commands.catalog': { params: { session_id?: string }; result: CommandsCatalog }
  /** Runs a quick, plugin, bundle, skill or one of a few built-in commands. Anything else is error 4018. */
  'command.dispatch': { params: { session_id: string; name: string; arg: string }; result: CommandDispatch }
  /** The server's own runner for the read-only built-ins (`/status`, `/usage`…): `{ output }`. */
  'slash.exec': { params: { session_id: string; command: string }; result: { output?: string; warning?: string } & Partial<CommandDispatch> }

  'approval.respond': {
    params: { session_id: string; request_id: string; choice: ApprovalChoice }
    /** `resolved: 0` means it was already answered or expired. */
    result: { resolved: number }
  }
  /** Rows come back without `choices` and with the command unredacted: never log or persist them. */
  'approval.pending': { params: { session_id: string }; result: { approvals: ApprovalRequestPayload[] } }
  'clarify.respond': {
    /** Answers are per question: send one call per `qid`; the tool resumes when every qid is answered.
     *  A multi-select answer is a JSON array string (`'["A","B"]'`). */
    params: { session_id: string; request_id: string; answer: string; question_id?: string }
    /** `expired` when the prompt timed out; `remaining` lists qids not yet answered. */
    result: { status: 'ok' | 'expired' | (string & {}); remaining?: string[] }
  }
  'secret.respond': {
    params: { session_id: string; request_id: string; value: string }
    result: Record<string, unknown>
  }
  'sudo.respond': {
    params: { session_id: string; request_id: string; password: string }
    result: Record<string, unknown>
  }

  'config.set': {
    params: { session_id?: string; key: string; value: string; profile?: string; confirm_expensive_model?: boolean }
    result: {
      key: string
      value: string
      warning?: string
      confirm_required?: boolean
      confirm_message?: string
      scope?: string
    }
  }

  'display.status': { params: { profile: string }; result: DisplayStatus }
  'display.start': { params: { profile: string }; result: DisplayStatus }
  'display.stop': { params: { profile: string; force?: boolean }; result: DisplayStatus & { stopped: boolean } }
  'display.thumbnail': { params: { profile: string }; result: DisplayThumbnailResult }
  /** `viewer_id`: one this connection minted earlier keeps its identity. */
  'display.observe': { params: { profile: string; viewer_id?: string }; result: DisplayObserveResult }
  'display.install': { params: { profile: string }; result: { started: boolean; command?: string | null; profile_key: string } }
  'display.lease.acquire': { params: { profile: string; viewer_id: string; reason?: string }; result: { lease: DisplayLease } }
  'display.lease.release': { params: { profile: string; viewer_id?: string; force?: boolean }; result: { lease: DisplayLease } }
  /** Group rooms: the server's own engine, so rooms keep going with the app closed. `driver: false` means no worker. */
  'groups.capabilities': { params: Record<never, never>; result: { protocol_version: number; driver: boolean; max_log_limit: number } }
  'groups.list': { params: { limit?: number; offset?: number; include_disbanded?: boolean }; result: { rooms: HostedRoom[]; next_offset: number | null } }
  'groups.create': { params: { room_id: string; name: string; members: RoomMember[] }; result: { room: HostedRoom } }
  'groups.state': { params: { room_id: string; include_disbanded?: boolean }; result: { room: HostedRoom; driver_status?: RoomDriverStatus } }
  /** `event_id` is yours (a retry key); the server stores its own id for it and returns the stored event. */
  'groups.send': {
    params: { room_id: string; event_id: string; payload: { text: string; thread_id: string } }
    result: { event: RoomEvent; client_event_id: string; accepted: boolean }
  }
  'groups.log': { params: { room_id: string; since_seq?: number; limit?: number; include_disbanded?: boolean }; result: RoomLogPage }
  'groups.rename': { params: { room_id: string; event_id: string; name: string }; result: { room: HostedRoom } }
  'groups.stop': { params: { room_id: string; cancel_id?: string }; result: { cancelled: number } }
  /** Only `once` and `deny` exist for rooms. */
  'groups.approve': {
    params: { room_id: string; member_id: string; task_id: string; execution_generation: number; choice: 'once' | 'deny'; request_id: string }
    result: { approved: boolean }
  }
  'groups.retry': { params: { room_id: string; task_id: string }; result: { retried: boolean } }
  'groups.disband': { params: { room_id: string; cancel_id?: string }; result: { tombstone: Record<string, unknown> } }
  /** Background processes the session owns, running or recently finished (Hermes Desktop's status stack polls it). */
  'process.list': { params: { session_id: string }; result: { processes: ProcessListRow[] } }
  /** Helpers (subagents) the session sent off that are still running. */
  'subagent.list': { params: { session_id: string }; result: { subagents: SubagentListRow[]; delegations?: unknown[] } }
  'tools.configure': {
    params: { profile?: string; action: 'enable' | 'disable'; names: string[]; session_id?: string }
    result: Record<string, unknown>
  }
}

export type RpcMethod = keyof RpcMethods

export interface CallOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export function call<M extends RpcMethod>(
  client: RpcClient,
  method: M,
  params: RpcMethods[M]['params'],
  options: CallOptions = {},
): Promise<RpcMethods[M]['result']> {
  return client.request<RpcMethods[M]['result']>(method, params as Record<string, unknown>, options.timeoutMs, options.signal)
}

/** True for a JSON-RPC error from the server with this code. */
export function isRpcCode(error: unknown, code: number): boolean {
  return error instanceof JsonRpcGatewayError && error.code === code
}

/**
 * Dev safety: refuse to send a prompt unless the session is pinned to the expected model.
 * `config.set model … --provider` on a session that has no agent yet is silently ineffective, so the
 * only safe pattern is to pin at `session.create` and check the reported model before submitting.
 */
export function assertPinnedModel(info: Pick<SessionInfo, 'model' | 'provider'> | undefined, expected: string): void {
  if (info?.model !== expected) {
    throw new Error(`session is on ${info?.model ?? 'an unknown model'}, not the dev model ${expected}; refusing to send`)
  }
}
