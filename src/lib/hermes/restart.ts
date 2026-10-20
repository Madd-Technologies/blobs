/**
 * Restarting Hermes from the app, through hermes-bot-mobile 0.1.7+ (`/api/plugins/hermes-bot-mobile/restart`): the
 * dashboard restarts as its own systemd unit, after the messaging gateway when asked, now or once no chat is running a
 * turn. A gateway-only restart is Hermes's own `POST /api/gateway/restart`. Pure: no React Native imports.
 */

import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

const ROUTE = '/api/plugins/hermes-bot-mobile/restart'

/** A chat running a turn right now, which a restart would stop. */
export interface RestartBusy {
  id: string
  /** Its stored id. */
  session: string
  title: string
  profile: string | null
  /** `working`, or `waiting` while it waits for the person's OK. */
  status: string
}

/** One restart request, as the plugin logged it and as far as it can tell what became of it. */
export interface RestartEntry {
  id: string
  requested_at: number
  mode: 'now' | 'idle'
  include_gateway: boolean
  /**
   * `waiting` (for the chats to finish), `restarting_gateway`, `scheduling`, `scheduled`, then `done`; or `cancelled`,
   * `replaced`, `timed_out`, `failed`, `not_restarted`, `interrupted`, `refused`.
   */
  outcome: string
  deadline?: number
  idle_timeout_s?: number
  finished_at?: number
  restarted_at?: number
  busy_left?: number
  detail?: string
}

export interface RestartStatus {
  /** Whether this dashboard can restart itself (it runs as its own systemd unit); `why` says why not. */
  supported: boolean
  why: string | null
  unit: string | null
  /** When this dashboard process started (epoch seconds): a newer one after a restart means it came back. */
  started_at: number | null
  now: number
  /** Chats running a turn, or null when the plugin cannot see them (then it cannot wait for them either). */
  busy: RestartBusy[] | null
  gateway: { route: boolean; restart: 'hermes' | 'cli'; same_unit: boolean | null }
  last: RestartEntry | null
  /** Seconds before another restart is taken (one a minute). */
  retry_after: number
}

/** A request the plugin refused, in its own words. */
export class RestartRefused extends Error {
  status: number
  retryAfter: number

  constructor(status: number, detail: string, retryAfter = 0) {
    super(detail)
    this.name = 'RestartRefused'
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** The plugin's `{detail, retry_after}` from a refused request, or the status line when it sent none. */
export function refusalOf(error: unknown): RestartRefused | null {
  if (!(error instanceof HermesHttpError)) {
    return null
  }

  const start = error.message.indexOf('{')
  let detail = ''
  let retryAfter = 0

  if (start >= 0) {
    try {
      const body = JSON.parse(error.message.slice(start)) as { detail?: unknown; retry_after?: unknown }
      detail = typeof body.detail === 'string' ? body.detail : ''
      retryAfter = typeof body.retry_after === 'number' ? body.retry_after : 0
    } catch {
      // The body was cut short in the message: read what can be read.
      detail = /"detail":\s*"([^"]*)/.exec(error.message)?.[1] ?? ''
      retryAfter = Number(/"retry_after":\s*(\d+)/.exec(error.message)?.[1] ?? 0)
    }
  }

  return new RestartRefused(error.status, detail || `The server said ${error.status}.`, retryAfter)
}

/** The restart status, or null when the server's hermes-bot-mobile has no restart route (older than 0.1.7, or none). */
export async function getRestartStatus(config: ServerConfig): Promise<RestartStatus | null> {
  try {
    return await restJson<RestartStatus>(config, ROUTE, {}, { timeoutMs: 10_000 })
  } catch (error) {
    if (error instanceof HermesHttpError && error.status === 404) {
      return null
    }

    throw error
  }
}

export interface RestartRequest {
  when: 'now' | 'idle'
  include_gateway: boolean
  /** How long to wait for the chats when `idle`: 30 to 1800 s (the plugin's default is 600). */
  idle_timeout_s?: number
}

/** Asks for a restart: `{accepted, id, mode, unit, include_gateway}`, or throws RestartRefused (409, 429 with retryAfter). */
export async function requestRestart(config: ServerConfig, request: RestartRequest): Promise<{ accepted: boolean; id: string }> {
  try {
    return await restJson<{ accepted: boolean; id: string }>(config, ROUTE, { method: 'POST', body: JSON.stringify(request) }, { timeoutMs: 15_000 })
  } catch (error) {
    throw refusalOf(error) ?? error
  }
}

/** Cancels the restart waiting for the chats; throws RestartRefused (404 none waits, 409 already under way). */
export async function cancelRestart(config: ServerConfig): Promise<void> {
  try {
    await restJson(config, ROUTE, { method: 'DELETE' }, { timeoutMs: 10_000 })
  } catch (error) {
    throw refusalOf(error) ?? error
  }
}

/** Restarts only the messaging gateway, with Hermes's own route (the dashboard, and this app's connection, stay up). */
export async function restartGateway(config: ServerConfig): Promise<void> {
  try {
    await restJson(config, '/api/gateway/restart', { method: 'POST', body: '{}' }, { timeoutMs: 15_000 })
  } catch (error) {
    throw refusalOf(error) ?? error
  }
}
