import type { GatewayEvent } from '../../lib/hermes/gateway-client.ts'
import type { ProfileRow, SessionInfo } from '../../lib/hermes/protocol.ts'
import { listSessionMessages, listSessionsPage, type StoredMessage } from '../../lib/hermes/rest.ts'
import type { RpcClient, RpcMethods } from '../../lib/hermes/rpc.ts'
import type { RequestBridge } from '../../lib/hermes/server-requests.ts'
import type { ServerConfig } from '../../lib/hermes/server.ts'
import type { TranscriptState } from '../transcript/types.ts'
import type { QueueTimers } from './queue.ts'

/** Rows fetched per page; the chat opens on the newest page and pages back from there. */
export const PAGE_SIZE = 50
/** Side chats read at a time on the Chats screen; more are read as you scroll. */
export const CHATS_PAGE = 30

export interface BotSession {
  profile: string
  /** `opening` shows the loading state only the first time; a re-open keeps the old transcript on screen. */
  phase: 'idle' | 'opening' | 'ready' | 'error'
  error: string | null
  storedId: string | null
  liveId: string | null
  transcript: TranscriptState
  info: Partial<SessionInfo> | null
  /** Newest-first pages loaded so far. */
  rows: StoredMessage[]
  hasOlder: boolean
  loadingOlder: boolean
}

export interface SessionsState {
  bots: Record<string, BotSession>
  /** Side chat currently shown per bot (`profile -> storedId`). */
  chosen: Record<string, string>
}

export interface ChatSummary {
  id: string
  title: string
  preview: string
  /** Epoch seconds. */
  startedAt: number
  messageCount: number
  source: string
}

export function summaryOf(entry: RpcMethods['session.list']['result']['sessions'][number]): ChatSummary {
  return {
    id: entry.id,
    title: entry.title ?? '',
    preview: entry.preview ?? '',
    startedAt: entry.started_at ?? 0,
    messageCount: entry.message_count ?? 0,
    source: entry.source ?? '',
  }
}

export interface SessionsDeps {
  client: RpcClient
  getConfig: () => ServerConfig | null
  getRosterRow: (profile: string) => ProfileRow | undefined
  onEvent: (handler: (event: GatewayEvent) => void) => () => void
  requests?: Pick<RequestBridge, 'answer' | 'ingest'>
  listMessages?: typeof listSessionMessages
  listSessions?: typeof listSessionsPage
  readBase64?: (uri: string) => Promise<string>
  now?: () => number
  timers?: QueueTimers
  sleep?: (ms: number) => Promise<void>
  liveWork?: () => boolean
  liveHelpers?: () => boolean
  catchUp?: (liveId: string) => Promise<boolean>
  follow?: (liveId: string) => Promise<void>
}

export type RespondResult = 'answered' | 'expired' | 'failed'

export interface ClarifyAnswer {
  questionId?: string
  answer: string
}
