/**
 * Sending a file from the server to one of the person's devices with Taildrop, through hermes-bot-mobile 0.1.7+
 * (`/api/plugins/hermes-bot-mobile/taildrop`): the server runs `tailscale file cp`, so the file never passes through the
 * phone. Pure: no React Native imports.
 */

import { HermesHttpError, restJson, type ServerConfig } from './server.ts'
import { refusalOf } from './restart.ts'

const ROUTE = '/api/plugins/hermes-bot-mobile/taildrop'

/** A device Taildrop offers, from `tailscale file cp --targets`. */
export interface TaildropTarget {
  name: string
  ip: string
  online: boolean
  /** What the CLI said about it, e.g. "offline; last seen 2h ago". */
  detail: string | null
  /** It is the device asking (this phone). */
  you: boolean
}

/** The one-time step the server needs before it may send: Tailscale's operator. */
export interface TaildropSetup {
  needed: 'operator'
  user: string
  command: string
}

export interface TaildropStatus {
  supported: boolean
  why: string | null
  targets: TaildropTarget[]
  you: { name: string; os: string | null; ip: string } | null
  setup: TaildropSetup | null
  max_bytes: number
  sending: string[]
}

export interface TaildropSend {
  id: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  target: string
  name: string
  sent_bytes: number | null
  total_bytes: number | null
  error: string | null
  note: string | null
  setup: TaildropSetup | null
}

/** The server's Taildrop status, or null when its hermes-bot-mobile has no Taildrop route (older than 0.1.7, or none). */
export async function getTaildrop(config: ServerConfig): Promise<TaildropStatus | null> {
  try {
    return await restJson<TaildropStatus>(config, ROUTE, {}, { timeoutMs: 15_000 })
  } catch (error) {
    if (error instanceof HermesHttpError && error.status === 404) {
      return null
    }

    throw error
  }
}

/** Starts sending a server file to `target` (a device's name or address); throws the plugin's refusal in its own words. */
export async function sendTaildrop(config: ServerConfig, body: { target: string; path: string; profile?: string; name?: string }): Promise<TaildropSend> {
  try {
    return await restJson<TaildropSend>(config, ROUTE, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 30_000 })
  } catch (error) {
    throw refusalOf(error) ?? error
  }
}

export function getTaildropSend(config: ServerConfig, id: string): Promise<TaildropSend> {
  return restJson<TaildropSend>(config, `${ROUTE}/${encodeURIComponent(id)}`, {}, { timeoutMs: 10_000 })
}

export async function cancelTaildropSend(config: ServerConfig, id: string): Promise<void> {
  try {
    await restJson(config, `${ROUTE}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { timeoutMs: 10_000 })
  } catch (error) {
    // Already finished (409) or forgotten (404): nothing left to stop.
    if (!(error instanceof HermesHttpError && (error.status === 404 || error.status === 409))) {
      throw error
    }
  }
}
