/**
 * The app's Hermes plugins on the connected server: whether each is there, on, loaded, and as new as the copy the app brings.
 *
 * Two sources, because neither says everything. Hermes's plugins hub (`/api/dashboard/plugins/hub`) reads the plugins folder on
 * disk, so it knows a plugin is installed and on before Hermes has loaded it; a plugin's own routes answer only once Hermes has
 * restarted with it. Without the hub (an older server), "not installed" and "installed, not restarted yet" look the same.
 * Pure apart from the two fetches: no React Native imports.
 */

import type { MemberActivity } from './rooms.ts'
import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

/** One row of Hermes's plugins hub (the fields used here). */
export interface HubPlugin {
  name: string
  version: string
  /** `inactive`: installed but not in `plugins.enabled`; `disabled`: turned off on purpose. */
  runtime_status: 'enabled' | 'disabled' | 'inactive' | (string & {})
}

export type PluginState =
  /** Not in the plugins folder (or, without the hub, not answering either). */
  | { kind: 'missing' }
  /** Installed but not turned on. */
  | { kind: 'off'; version: string | null }
  /** Installed and on, but Hermes has not loaded it: it needs a restart. */
  | { kind: 'restart'; version: string | null }
  /** Loaded and answering. `update`: the server's copy is older than the app's. */
  | { kind: 'ready'; version: string | null; update: boolean }
  /** Couldn't tell (the server didn't answer). */
  | { kind: 'unknown'; error: string }

/** -1, 0 or 1, comparing dotted numbers (`0.10.0` > `0.9.2`); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0)
  const left = parts(a)
  const right = parts(b)

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)

    if (difference !== 0) {
      return difference < 0 ? -1 : 1
    }
  }

  return 0
}

/**
 * What to tell the user about one plugin. `hub` is null when the server has no plugins hub (or would not show it); `answering` is
 * whether the plugin's own route answered; `bundled` is the version the app brings.
 */
export function pluginState(name: string, hub: HubPlugin[] | null, answering: boolean, bundled: string): PluginState {
  const row = hub?.find(entry => entry.name === name)
  const version = row?.version || null

  if (answering) {
    return { kind: 'ready', version, update: !!hub && (!version || compareVersions(version, bundled) < 0) }
  }

  if (!row) {
    return { kind: 'missing' }
  }

  return row.runtime_status === 'enabled' ? { kind: 'restart', version } : { kind: 'off', version }
}

/** A 404, or the web app's HTML for a path it doesn't know (a JSON parse error): the route isn't there. */
export const isAbsent = (error: unknown): boolean => (error instanceof HermesHttpError && (error.status === 404 || error.status === 405)) || error instanceof SyntaxError

/**
 * How long the hub may take. Hermes 0.21.6 builds it the way `hermes plugins list` does, which can take a minute and more on a
 * busy server; past this the hub is given up on, like a server that has none.
 */
export const HUB_MS = 10_000

/**
 * Hermes's plugins hub, or null when this server has none or won't show it (older Hermes, or a sign-in that can't read it).
 * Throws when it fails, or doesn't answer within `timeoutMs`.
 */
export async function pluginHub(config: ServerConfig, timeoutMs = HUB_MS): Promise<HubPlugin[] | null> {
  try {
    const hub = await restJson<{ plugins?: HubPlugin[] }>(config, '/api/dashboard/plugins/hub', {}, { timeoutMs })

    return Array.isArray(hub?.plugins) ? hub.plugins : null
  } catch (error) {
    if (isAbsent(error) || (error instanceof HermesHttpError && (error.status === 401 || error.status === 403))) {
      return null
    }

    throw error
  }
}

/** hermes-paperless's own status route: whether Paperless is set up on the server, and where. */
export interface PaperlessStatus {
  configured: boolean
  host: string | null
}

export async function getPaperlessStatus(config: ServerConfig): Promise<PaperlessStatus | null> {
  try {
    const status = await restJson<PaperlessStatus>(config, '/api/plugins/hermes-paperless/status')

    return typeof status?.configured === 'boolean' ? status : null
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}

/** hermes-drive's own status route: whether the server's Google sign-in exists and reaches Drive, and for whom. */
export interface DriveStatus {
  configured: boolean
  drive: boolean
  account: string | null
}

export async function getDriveStatus(config: ServerConfig): Promise<DriveStatus | null> {
  try {
    const status = await restJson<DriveStatus>(config, '/api/plugins/hermes-drive/status')

    return typeof status?.configured === 'boolean' ? status : null
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}

/**
 * What each bot in a room is doing right now (hermes-bot-mobile's room activity), by member id; null when the server
 * has no such route (an older plugin, or none).
 */
export async function getRoomActivity(config: ServerConfig, roomId: string): Promise<Record<string, MemberActivity> | null> {
  try {
    const answer = await restJson<{ members?: Record<string, MemberActivity> }>(config, `/api/plugins/hermes-bot-mobile/rooms/${encodeURIComponent(roomId)}/activity`, {}, { timeoutMs: 8000 })

    return answer && typeof answer.members === 'object' && answer.members ? answer.members : null
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}
