/**
 * The push routes of the app's server plugin: `hermes-bot-mobile` (github.com/Madd-Technologies/blobs-hermes-bot-plugins), or the
 * older `hermes-push` it replaced, whose routes are the same. Whichever answers is remembered per server. Pure: no React
 * Native imports.
 */

import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

/** Newest first: a server moved to hermes-bot-mobile may still have hermes-push installed (disabled, for rollback). */
export const PUSH_PLUGINS = ['hermes-bot-mobile', 'hermes-push'] as const
export type PushPlugin = (typeof PUSH_PLUGINS)[number]

const answering = new Map<string, PushPlugin>()

const base = (plugin: PushPlugin) => `/api/plugins/${plugin}`

/** The plugin this server's pushes go through: as last seen, else asked (a call before any status must not guess). */
async function current(config: ServerConfig): Promise<PushPlugin> {
  if (!answering.has(config.baseUrl)) {
    await getPushStatus(config)
  }

  return answering.get(config.baseUrl) ?? PUSH_PLUGINS[0]
}

/**
 * A call to the answering plugin's `path`. A 404 can mean the server moved plugins since (hermes-push to hermes-bot-mobile,
 * then a restart): it asks again once and retries if another plugin answers now.
 */
async function call<T>(config: ServerConfig, path: string, init: RequestInit, options?: { timeoutMs?: number }): Promise<T> {
  const plugin = await current(config)

  try {
    return await restJson<T>(config, `${base(plugin)}${path}`, init, options)
  } catch (error) {
    if (!(error instanceof HermesHttpError && error.status === 404)) {
      throw error
    }

    answering.delete(config.baseUrl)
    const now = await current(config)

    if (now === plugin) {
      throw error
    }

    return restJson<T>(config, `${base(now)}${path}`, init, options)
  }
}

/** How loud a bot may be: everything, only what blocks it (approvals, questions, broken routines), or nothing. */
export type PushLevel = 'all' | 'needs_you' | 'off'

export const PUSH_LEVELS: PushLevel[] = ['all', 'needs_you', 'off']

/** A registered phone. The server never hands its keys back. */
export interface PushDevice {
  id: string
  name: string
  /** Where its pushes are sent (the push server's host), for display. */
  host: string | null
  created: number | null
  /** Epoch seconds of the last push the push service accepted. */
  last_ok: number | null
  /** What went wrong with the last push, if it did. */
  last_error: string | null
}

export interface PushSettings {
  default: PushLevel
  bots: Record<string, PushLevel>
}

export interface PushStatus {
  devices: PushDevice[]
  settings: PushSettings
  /**
   * The server's VAPID public key (87 characters). The phone's push library refuses to register without a well-formed
   * one. Absent from a plugin that predates it.
   */
  vapid?: string
}

export interface TestResult {
  device: string
  ok: boolean
  status: number | null
  error: string | null
  /** The push service says this phone's subscription no longer exists (the server forgot it). */
  gone: boolean
}

/**
 * The plugin's state, or null when the server does not have it. A server without the plugin answers 404, or
 * hands back its web app's HTML for an unknown path; both mean "not installed" rather than "broken".
 */
export async function getPushStatus(config: ServerConfig): Promise<PushStatus | null> {
  for (const plugin of PUSH_PLUGINS) {
    const status = await pushStatusFrom(config, plugin)

    if (status) {
      answering.set(config.baseUrl, plugin)

      return status
    }
  }

  answering.delete(config.baseUrl)

  return null
}

/** One plugin's status route, or null when that plugin is not loaded on the server. */
export async function pushStatusFrom(config: ServerConfig, plugin: PushPlugin): Promise<PushStatus | null> {
  try {
    const status = await restJson<PushStatus>(config, `${base(plugin)}/status`)

    return Array.isArray(status?.devices) && status.settings ? status : null
  } catch (error) {
    if ((error instanceof HermesHttpError && error.status === 404) || error instanceof SyntaxError) {
      return null
    }

    throw error
  }
}

export async function addPushDevice(config: ServerConfig, device: { endpoint: string; p256dh: string; auth: string; name: string }): Promise<PushDevice> {
  return call<PushDevice>(config, '/devices', { method: 'POST', body: JSON.stringify(device) })
}

export async function removePushDevice(config: ServerConfig, id: string): Promise<unknown> {
  return call(config, `/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Sets the default level and/or bots' levels; a bot set to null follows the default again. */
export async function setPushLevels(config: ServerConfig, change: { default?: PushLevel; bots?: Record<string, PushLevel | null> }): Promise<PushSettings> {
  return call<PushSettings>(config, '/settings', { method: 'PUT', body: JSON.stringify(change) })
}

/** Sends a real push to one phone (or all) and reports what the push service answered. */
export async function sendPushTest(config: ServerConfig, device?: string): Promise<TestResult[]> {
  const { results } = await call<{ results: TestResult[] }>(config, '/test', { method: 'POST', body: JSON.stringify(device ? { device } : {}) })

  return results
}

/** What this phone has on screen (see features/push/presence.ts). 404 means the server does not know this phone. */
export async function setPushPresence(config: ServerConfig, body: { device: string; foreground: boolean; sessions: string[] }): Promise<unknown> {
  return call(config, '/presence', { method: 'PUT', body: JSON.stringify({ ...body, ttl: 45 }) }, { timeoutMs: 10_000 })
}
