/**
 * Typed shapes of the Hermes `/api/ws` protocol (v0.21.0), as observed from a real server (see
 * docs/protocol.md and docs/protocol-captures/). Fields the server has been seen to send are
 * required; anything situational is optional. Pure: no React Native imports.
 */

import type { GatewayEvent } from './gateway-client.ts'
import type { BotMeta } from './identity.ts'

/** `ui_meta['hermes-bots']`, re-exported so protocol consumers need one import. */
export type { BotMeta } from './identity.ts'

// ── roster ───────────────────────────────────────────────────────────────────────────────────────

export interface CanonicalSession {
  id: string
  /** The compression-lineage tip: open this one when present. */
  resolved_id?: string
  root_title?: string
  title?: string
  preview?: string
  started_at?: number
  last_active?: number
  message_count?: number
}

export interface ProfileRow {
  name: string
  path: string
  is_default: boolean
  model: string
  provider: string
  description: string
  display_name: string
  skill_count: number
  last_session: SessionPreview | null
  /** Kanban/tool worker heartbeat; a stamp under ~150 s old means the bot is busy. */
  worker_session: { last_active?: number } | null
  canonical_session: CanonicalSession | null
  /** Role/title string; null for a profile with no configured role. */
  title?: string | null
  ui_meta?: { 'hermes-bots'?: BotMeta } & Record<string, unknown>
  /** Compare-and-swap revision per ui_meta key. */
  ui_meta_revisions: Record<string, number>
  has_avatar: boolean
}

export interface SessionPreview {
  id?: string
  title?: string
  preview?: string
  last_active?: number
}

/** `profiles.describe`: what one bot is made of. */
export interface ProfileDescription {
  name: string
  description: string
  /** The contents of SOUL.md: the bot's standing instructions. */
  soul: string
  model: { provider: string; default: string }
  /** A skill is on unless it is listed as disabled. */
  skills: { name: string; enabled: boolean }[]
  toolsets: { name: string; label: string; description: string; tool_count: number; enabled: boolean }[]
  /** `platform_toolsets.cli` is pinned (an explicit list) rather than following the default. */
  toolsets_pinned: boolean
  mcp_servers: { name: string; enabled: boolean; transport: string }[]
}

/** `profiles.configure`: each section is optional and applied on its own. */
export interface ProfileConfigureParams {
  name: string
  ui_meta?: Record<string, unknown>
  /** Per `ui_meta` key: the revision this write was based on. Any mismatch rejects the whole `ui_meta` write. */
  ui_meta_expected_revisions?: Record<string, number>
  soul?: string
  description?: string
  model?: string
  provider?: string
  confirm_expensive_model?: boolean
  disabled_skills?: string[]
  enabled_toolsets?: string[]
  enabled_mcp_servers?: string[]
}

export interface ProfileConfigureResult {
  /** True only if every section sent succeeded (and when nothing was sent). */
  ok: boolean
  applied: {
    ui_meta?: boolean
    ui_meta_revisions?: Record<string, number>
    ui_meta_conflicts?: Record<string, { expected: number; actual: number }>
    soul?: boolean
    description?: boolean
    model?: boolean | Record<string, unknown>
    skills?: boolean | Record<string, unknown>
    toolsets?: boolean | Record<string, unknown>
    mcp_servers?: boolean | Record<string, unknown>
  }
  /** The model picked is flagged (cost); nothing was written. Send again with `confirm_expensive_model`. */
  confirm_required?: boolean
  confirm_message?: string
}

export interface ProfileCreateParams {
  /** `^[a-z0-9][a-z0-9_-]{0,63}$`. */
  name: string
  description?: string
  /** A profile to copy skills and settings from; omitted makes a fresh one. */
  clone_from?: string
  /** Use the source's credentials rather than none. */
  share_auth?: boolean
  soul?: string
  model?: string
  provider?: string
}

export interface ProfileCreateResult {
  ok: boolean
  name: string
  path: string
  soul_written: boolean
  model_set: boolean
}

/** One provider in `model.options`: who serves models, and which. */
export interface ModelProviderRow {
  slug: string
  name: string
  is_current?: boolean
  models?: string[]
  total_models?: number
  /** The newest few models of an aggregator, for a short default list. */
  featured_models?: string[]
  /** False when no credential is set up for it. */
  authenticated?: boolean
  warning?: string
}

/** `model.options`: every provider the bot can use, and what it uses now. */
export interface ModelOptions {
  providers: ModelProviderRow[]
  model: string
  provider: string
}

export interface ProfilesListResult {
  profiles: ProfileRow[]
  bot_mode_protocol: boolean
}

// ── sessions ─────────────────────────────────────────────────────────────────────────────────────

export type ActiveStatus = 'idle' | 'starting' | 'working' | 'waiting'

export interface ActiveSessionRow {
  /** The live id (what RPCs take). */
  id: string
  /** The stored id (what REST and `canonical_session.id` use). There is no profile field: map by this. */
  session_key: string
  status: ActiveStatus
  /** True for the connection's own current session. */
  current?: boolean
  model?: string
  last_active?: number
  started_at?: number
  message_count?: number
  preview?: string
  title?: string
}

/** Runtime facts about a session; sent on `session.create`, `session.resume` and as `session.info` events. */
export interface SessionInfo {
  model: string
  provider: string
  reasoning_effort?: string
  service_tier?: string
  fast?: boolean
  yolo?: boolean
  /** `manual` asks for risky commands, `smart` lets a guardian model decide first, `off` never asks. */
  approval_mode?: 'manual' | 'smart' | 'off' | (string & {})
  tools?: Record<string, string[]>
  skills?: Record<string, string[]>
  cwd?: string
  branch?: string
  project?: unknown
  /** True until the agent is built (the first prompt). */
  lazy?: boolean
  running?: boolean
  profile_name?: string
  terminal_backend?: string
  desktop_contract?: number
}

export interface SessionCreateResult {
  /** The live id used by every other RPC. */
  session_id: string
  /** The durable id used by REST (`/api/sessions/{id}`). */
  stored_session_id: string
  message_count: number
  messages: unknown[]
  info: SessionInfo
}

/** What `session.resume` reports about the latest turn. Present even when idle: after a failed turn it
 *  carries the error (`status: 'error'`, `recoverable`), so only treat it as "in flight" if `running`. */
export interface Inflight {
  assistant?: string
  streaming?: boolean
  user?: string
  error?: string
  status?: string
  recoverable?: boolean
  error_surface?: { layer?: string; code?: string; retryable?: boolean; provider?: string; model?: string }
}

export interface SessionResumeResult {
  /** Re-key by this: it is the same id if the session was still live, a new one otherwise. */
  session_id: string
  /** The stored id. */
  session_key: string
  resumed?: string
  running: boolean
  status?: string
  started_at?: number
  turn_started_at?: number
  message_count?: number
  /** True when `omit_messages` was passed: fetch the transcript over REST instead. */
  messages_omitted?: boolean
  messages?: unknown[]
  inflight?: Inflight | null
  pending_approval?: ApprovalRequestPayload | null
  pending_clarify?: ClarifyRequestPayload | null
  /** Hermes 0.21.5+: prompts still waiting on a person, as the server requests that asked them. */
  open_requests?: { id: string | number; method: string; params?: Record<string, unknown> }[]
  todo_state?: unknown
  info?: Partial<SessionInfo>
}

export type SubmitStatus = 'streaming' | 'queued' | 'redirected' | 'steered'

export interface PromptSubmitResult {
  status: SubmitStatus
}

// ── events ───────────────────────────────────────────────────────────────────────────────────────

export interface Usage {
  model?: string
  input?: number
  output?: number
  reasoning?: number
  prompt?: number
  completion?: number
  total?: number
  calls?: number
  context_used?: number
  context_max?: number
  context_percent?: number
  [key: string]: unknown
}

export type MessageStatus = 'complete' | 'interrupted' | 'error'

export interface ToolResult {
  output?: string
  exit_code?: number | null
  /** Hermes sends `null` when there was none. */
  error?: string | null
  /** `blocked` when the user denied an approval. */
  status?: string
  [key: string]: unknown
}

export interface ApprovalRequestPayload {
  /** Redacted by the server in the event; `approval.pending` returns it unredacted. */
  command: string
  pattern_key?: string
  pattern_keys?: string[]
  /** Human description of why it was flagged. Safe to show or push. */
  description: string
  request_id: string
  allow_session?: boolean
  allow_permanent?: boolean
  /** Absent from `approval.pending` rows, so build them client-side there. */
  choices?: ApprovalChoice[]
}

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export interface ClarifyQuestion {
  /** Server-assigned id (`q0`, `q1`, …) for matching answers to questions. */
  qid?: string
  question: string
  /** The server appends "(Recommended)" to the first choice. */
  choices?: string[] | null
  multi_select?: boolean
}

export interface ClarifyRequestPayload {
  request_id: string
  /** Always present on a live `clarify.request`, even for one question. */
  questions?: ClarifyQuestion[]
  /** Legacy single-question form (older servers; also what a resumed `pending_clarify` may use). */
  question?: string
  choices?: string[] | null
  multi_select?: boolean
}

/**
 * A `subagent.*` event (helpers a bot sent off with `delegate_task`), as far as the app reads it. Hermes 0.22 always runs them in
 * the background: these frames keep coming after the step that started them returned.
 */
export interface SubagentEventPayload {
  goal?: string
  /** How many children the delegation started. */
  task_count?: number
  task_index?: number
  subagent_id?: string
  delegation_id?: string
  /** On `subagent.complete`: `completed`, `failed`, `error`, `timeout` or `interrupted`. */
  status?: string
  duration_seconds?: number
}

/** A `process.list` row: a background process the session owns, running or recently finished. */
export interface ProcessListRow {
  /** The process id (`proc_…`), not a chat session. */
  session_id: string
  command?: string
  /** Seconds since it started at the moment of the call; it keeps counting after the process exits. */
  uptime_seconds?: number
  /** `running` or `exited`. */
  status?: string
  exit_code?: number | null
  /** Epoch seconds. */
  exited_at?: number | null
  /** The last 4000 characters of output. */
  output_tail?: string | null
  output_preview?: string
}

/** A `subagent.list` row: a child that is still running (finished ones drop out of the list). */
export interface SubagentListRow {
  subagent_id: string
  goal?: string | null
  delegation_id?: string | null
  /** Epoch seconds. */
  started_at?: number | null
  status?: string | null
}

/**
 * A `delegation.status` row: one helper running anywhere on the server (`ActiveSubagent`, the same from Hermes 0.21.5 to
 * 0.22.2), with the stored session id of the chat whose bot sent it off.
 */
export interface DelegationStatusRow {
  subagent_id: string
  /** Set for a helper another helper started. */
  parent_id?: string | null
  goal?: string | null
  delegation_id?: string | null
  status?: string | null
  owner_agent_session_id?: string | null
}

/** Payload of every event the app handles. Events not listed here are ignored. */
export interface EventPayloads {
  'gateway.ready': { replay_epoch?: string; heartbeat?: boolean }
  'session.info': SessionInfo
  'session.title': { session_id: string; title: string }
  'session.usage': { usage: Usage }
  'message.start': Record<string, never>
  'message.delta': { text: string }
  /** A mid-turn assistant message; skip it if `already_streamed` (the deltas drew it). */
  'message.interim': { text: string; already_streamed?: boolean }
  'message.complete': { text: string; usage?: Usage; status: MessageStatus; error?: string }
  'thinking.delta': { text: string }
  'reasoning.delta': { text: string }
  'reasoning.available': { text: string }
  'status.update': { kind: string; text: string }
  'tool.generating': { name: string }
  'tool.start': { tool_id: string; name: string; context?: string; args?: Record<string, unknown> }
  'tool.progress': { tool_id?: string; name?: string; text?: string; [key: string]: unknown }
  'tool.complete': {
    tool_id: string
    name: string
    args?: Record<string, unknown>
    duration_s?: number
    result?: ToolResult | string
    summary?: string
    inline_diff?: string
  }
  'todo.updated': { todos?: unknown[]; [key: string]: unknown }
  /** Hermes 0.22: what a background command printed, sent to the chat whose step started it. */
  'agent.terminal.output': { process_id: string; chunk: string }
  'subagent.spawn_requested': SubagentEventPayload
  'subagent.start': SubagentEventPayload
  'subagent.progress': SubagentEventPayload
  'subagent.tool': SubagentEventPayload
  'subagent.complete': SubagentEventPayload
  'approval.request': ApprovalRequestPayload
  'clarify.request': ClarifyRequestPayload
  'secret.request': { request_id: string; prompt?: string; env_var?: string }
  'sudo.request': { request_id: string }
  'approval.expire': { request_id: string }
  'clarify.expire': { request_id: string }
  'secret.expire': { request_id: string }
  'sudo.expire': { request_id: string }
  error: { message: string }
  'sessions.changed': Record<string, never>
  'cron.changed': Record<string, never>
  'skin.changed': Record<string, unknown>
}

export type EventType = keyof EventPayloads

/** A server event with a known type, its payload narrowed. `seq` is per session and increasing. */
export type HermesEvent = {
  [K in EventType]: { type: K; session_id?: string; seq?: number; payload: EventPayloads[K] }
}[EventType]

/** Narrow a raw gateway event. Returns null for event types this app does not handle. */
export function asHermesEvent(event: GatewayEvent): HermesEvent | null {
  if (!EVENT_TYPES.has(event.type)) {
    return null
  }

  const seq = (event as { seq?: unknown }).seq

  return {
    type: event.type as EventType,
    session_id: event.session_id,
    seq: typeof seq === 'number' ? seq : undefined,
    payload: event.payload ?? {},
  } as HermesEvent
}

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  'gateway.ready',
  'session.info',
  'session.title',
  'session.usage',
  'message.start',
  'message.delta',
  'message.interim',
  'message.complete',
  'thinking.delta',
  'reasoning.delta',
  'reasoning.available',
  'status.update',
  'tool.generating',
  'tool.start',
  'tool.progress',
  'tool.complete',
  'todo.updated',
  'agent.terminal.output',
  'subagent.spawn_requested',
  'subagent.start',
  'subagent.progress',
  'subagent.tool',
  'subagent.complete',
  'approval.request',
  'clarify.request',
  'secret.request',
  'sudo.request',
  'approval.expire',
  'clarify.expire',
  'secret.expire',
  'sudo.expire',
  'error',
  'sessions.changed',
  'cron.changed',
  'skin.changed',
])

/** Events that end a turn. After `message.complete` the server also sends `session.info {running:false}`. */
export function isTurnEnd(event: HermesEvent): boolean {
  return event.type === 'message.complete'
}

/**
 * The four prompts the agent can put to the user. Hermes 0.21.0 sends them as events; 0.21.5 and later send
 * server requests instead, which `server-requests.ts` turns into these same events.
 */
export type PromptEventType = 'approval.request' | 'clarify.request' | 'secret.request' | 'sudo.request'

export function isPromptEvent(event: HermesEvent): event is Extract<HermesEvent, { type: PromptEventType }> {
  return (
    event.type === 'approval.request' ||
    event.type === 'clarify.request' ||
    event.type === 'secret.request' ||
    event.type === 'sudo.request'
  )
}

// ── errors ───────────────────────────────────────────────────────────────────────────────────────

/** JSON-RPC error codes the app reacts to. */
export const RpcCode = {
  /** `-32601`: the method does not exist on this server (e.g. `display.*` on Hermes 0.21.0). */
  MethodNotFound: -32601,
  /** Stale live session id: re-resume. */
  StaleSession: 4001,
  /** Stored session not found: recreate Bot Chat. */
  SessionNotFound: 4007,
  /** Session is settling: retry with backoff. */
  Settling: 4009,
  /** Session too large to resume. */
  TooLarge: 4130,
  /** Refused: read `data.reason` (live owner or capacity). */
  Refused: 4090,
  /** Bot Screen refused or failed; `data.code` may be `viewer_mismatch`. */
  Display: 5300,
  /** Group worker is not running. */
  GroupWorkerDown: 4123,
} as const


// ── Bot Screen (Hermes 0.21.5+) ──────────────────────────────────────────────────────────────────
// Source: upstream `tui_gateway/contracts/display.py`. Every `display.*` method takes `profile`.

export type LeaseHolder = 'agent' | 'human'

/** Who may drive the screen. `viewer_hash` is `sha256(viewer id)[:12]`: a holder recognises itself by it. */
export interface DisplayLease {
  holder: LeaseHolder
  viewer_hash?: string | null
  /** Epoch seconds. */
  since: number
  /** Moves on every real change of hands. */
  epoch: number
  reason: string
}

export interface DisplayStatus {
  profile: string
  supported: boolean
  installed: boolean
  /** Binaries the host still lacks. */
  missing: string[]
  running: boolean
  pid?: number | null
  display?: string | null
  socket?: string | null
  /** "1440x900". */
  geometry: string
  install_command?: string | null
  browser?: string | null
  /** Why `display.start` would refuse right now (host memory); shown instead of Start. */
  blocker?: string | null
  memory_available_mb?: number | null
  memory_limit_mb?: number | null
  lease: DisplayLease
  /** The profile's home on the host (event payloads name a screen by this, not by profile). */
  profile_key: string
}

export interface DisplayObserveResult extends DisplayStatus {
  /** Single-use, 30 s: redeemed on the display websocket. */
  ticket: string
  path: string
  /** Minted for THIS connection: a reconnect gets a new one. */
  viewer_id: string
}

export interface DisplayThumbnailResult {
  /** A JPEG data URL; null while the screen is stopped or a human holds it. */
  data_url: string | null
  suppressed?: string | null
}

// ── group rooms (`groups.*`, Hermes 0.21.6) ──────────────────────────────────────────────────────

/** One bot in a room. `member_id` and `handle` are chosen by the client; the profile must live on the same server. */
export interface RoomMember {
  member_id: string
  profile: string
  /** What `@handle` means in this room: unique, never `all` or `everyone`. */
  handle: string
  display_name?: string
}

export interface HostedRoom {
  room_id: string
  name: string
  members: RoomMember[]
  authority_gateway_id: string
  authority_epoch: number
  revision: number
  /** Epoch seconds. */
  created_at: number
  updated_at: number
  /** Number of the newest event in the room's log; 0 when nothing has been logged. */
  latest_seq?: number
  disbanded_at?: number
}

/** `user` is you (always the same actor), `member` a bot, `gateway` the turn driver, `system` the room itself. */
export interface RoomActor {
  kind: 'user' | 'member' | 'gateway' | 'system' | (string & {})
  id: string
  display_name?: string
  profile?: string
}

export interface RoomEvent {
  room_id: string
  seq: number
  event_id: string
  /** `message.user`, `message.member`, `turn.settled|failed|cancelled|deferred`, `room.activity`, `room.stop_requested`, ... */
  kind: string
  actor: RoomActor
  payload: Record<string, unknown>
  /** Epoch seconds. */
  created_at: number
}

export interface RoomLogPage {
  events: RoomEvent[]
  /** Pass as `since_seq` for the next page. */
  cursor: number
  latest_seq: number
  has_more: boolean
}

/** Something a room is waiting on you for. Approvals carry the command: show it, never log or store it. */
export interface RoomPendingAction {
  kind: 'approval' | 'retry' | (string & {})
  task_id: string
  member_id?: string
  execution_generation?: number
  request_id?: string
  approval?: { command?: string; description?: string; choices?: string[]; [key: string]: unknown }
}

export interface RoomDriverStatus {
  running: boolean
  /** Some member is replying or queued. */
  working: boolean
  blocked: boolean
  counts: Record<string, number>
  pending_actions: RoomPendingAction[]
}

// ── attachments ──────────────────────────────────────────────────────────────────────────────────

export interface AttachedImageResult {
  attached: boolean
  path?: string
  count?: number
  /** What to say in the message for it ("[User attached image: upload_1.png]"). */
  text?: string
  /** Why nothing was attached. */
  message?: string
}

export interface AttachedPdfResult {
  attached: boolean
  filename: string
  pages_attached: number
  text: string
}

export interface AttachedFileResult {
  attached: boolean
  name: string
  path: string
  /** `@file:path`, relative to the session's workspace: goes into the message text. */
  ref_text: string
  uploaded: boolean
}

// ── slash commands ───────────────────────────────────────────────────────────────────────────────
// Source: upstream `tui_gateway/methods_tools.py` (`commands.catalog`, `command.dispatch`) and `methods_slash.py`.

/** `commands.catalog`: every slash command the session could run, and every skill. Only what the picker reads is typed. */
export interface CommandsCatalog {
  /** Every `[ "/name", "description" ]`: built-in commands, the bot's own quick and plugin commands, then skills. */
  pairs: [string, string][]
  /** Lowercase `/name` or `/alias` → its canonical `/name`, for the built-in and user commands. */
  canon: Record<string, string>
  /** Skills by `/name`, with how often each has been used (the picker ranks by it) and where it came from. */
  skills: Record<string, { usage?: number; origin?: string }>
  categories?: { name: string; pairs: [string, string][] }[]
  /** Every built-in command, the ones the picker hides included (`/approve`), with how Desktop treats it. */
  commands?: Record<string, { argument_mode?: string | null; desktop?: string | null }>
  /** Why part of the catalog could not be read (a skill or plugin failed to load); the rest is still good. */
  warning?: string
}

/** What `command.dispatch` can answer. `display` is what to show for a message the model sees expanded. */
export type CommandDispatch =
  | { type: 'exec'; output: string }
  | { type: 'plugin'; output: string }
  | { type: 'alias'; target: string }
  | { type: 'send'; message: string; notice?: string; display?: string; name?: string }
  | { type: 'skill'; message: string; notice?: string; display?: string; name?: string }
  | { type: 'prefill'; message: string; notice?: string }
