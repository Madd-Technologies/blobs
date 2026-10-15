/**
 * Typed REST calls for the Hermes server (everything that is not the WebSocket). Add an endpoint
 * here when the app first uses it. Pure: no React Native imports.
 */

import { restJson, type ServerConfig } from './server.ts'

/** One row of `GET /api/sessions/{id}/messages`. */
export interface StoredMessage {
  id: number | string
  session_id?: string
  role: 'user' | 'assistant' | 'tool' | 'system' | (string & {})
  content: string | null
  /** What to show when it differs from `content` (e.g. a slash command's visible form). */
  display_content?: string | null
  /** `hidden` rows (injected context, markers) are never drawn. */
  display_kind?: string | null
  tool_calls?: { id: string; function: { name: string; arguments: string } }[] | null
  /** On a `tool` row: which call this result belongs to. */
  tool_call_id?: string | null
  tool_name?: string | null
  timestamp?: number
  reasoning?: string | null
  finish_reason?: string | null
  /** Compacted rows were summarized away; pass `includeCompacted` to see them. */
  compacted?: number
  active?: number
  [key: string]: unknown
}

export interface MessagesPage {
  session_id: string
  /** Oldest first within the page, whichever `order` selected which rows. */
  messages: StoredMessage[]
  pagination: { limit: number; offset: number; order: string; returned: number }
}

export interface MessagesQuery {
  /** `latest` returns the newest rows first, which is what a chat opens with. */
  order?: 'latest' | 'oldest'
  limit?: number
  /** Skip this many rows, to page further back. */
  offset?: number
  includeCompacted?: boolean
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)

  return parts.length ? `?${parts.join('&')}` : ''
}

/** Transcript of a stored session. Open Bot Chat with `order: 'latest'`, then page back with `offset`. */
export function listSessionMessages(
  config: ServerConfig,
  storedId: string,
  profile: string,
  query: MessagesQuery = {},
): Promise<MessagesPage> {
  return restJson<MessagesPage>(
    config,
    `/api/sessions/${encodeURIComponent(storedId)}/messages${qs({
      profile,
      order: query.order,
      limit: query.limit,
      offset: query.offset,
      include_compacted: query.includeCompacted,
    })}`,
  )
}

export function deleteSession(config: ServerConfig, storedId: string, profile: string): Promise<unknown> {
  return restJson(config, `/api/sessions/${encodeURIComponent(storedId)}${qs({ profile })}`, { method: 'DELETE' })
}

/** Deletes a profile. Callers must never pass `default`; only throwaway `zz-*` bots in dev. */
export function deleteProfile(config: ServerConfig, name: string): Promise<unknown> {
  if (name === 'default') {
    return Promise.reject(new Error(`refusing to delete the protected profile "${name}"`))
  }

  return restJson(config, `/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

/** A bot's whole `config.yaml`, normalised for the web (large: read what you need and drop it). */
export function getBotConfig(config: ServerConfig, profile: string): Promise<Record<string, unknown>> {
  return restJson<Record<string, unknown>>(config, `/api/config${qs({ profile })}`)
}

/** Merges `change` into a bot's config (the server deep-merges, so only what is sent is overwritten). */
export function updateBotConfig(config: ServerConfig, profile: string, change: Record<string, unknown>): Promise<unknown> {
  return restJson(config, `/api/config${qs({ profile })}`, { method: 'PUT', body: JSON.stringify({ config: change, profile }) })
}
