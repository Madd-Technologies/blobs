/**
 * Keeps a signed-in session's tokens fresh. Pure: the store supplies how to read and save the config.
 *
 * A sign-in provider may rotate the refresh token on every use (the self-hosted password one does not
 * invalidate the old token, others may), so two refreshes racing each other could spend the same token
 * twice and sign the user out. Every caller therefore goes through `fresh()`, which shares one refresh
 * between all of them and always works from the config as it is *now*, never from a copy a caller was
 * holding while another refresh finished.
 */

import { needsRefresh, refreshAuth, type OAuthAuth } from './auth.ts'
import type { ServerConfig } from './server.ts'

/** Refresh this long before the access token runs out. */
export const REFRESH_SKEW_S = 120

export interface KeeperDeps {
  getConfig: () => ServerConfig | null
  /** Stores the refreshed config (persist it, then publish it). */
  apply: (config: ServerConfig) => Promise<void>
  /** Epoch seconds. */
  nowS: () => number
  refresh?: (baseUrl: string, auth: OAuthAuth) => Promise<OAuthAuth>
}

/**
 * Milliseconds until a refresh is due. Never less than 30 s: a bad clock, or a server whose tokens live
 * shorter than the margin above, must not turn this into a refresh loop.
 */
export function refreshDelayMs(auth: OAuthAuth, nowS: number): number {
  return Math.max(30, auth.expiresAt - REFRESH_SKEW_S - nowS) * 1000
}

export function createKeeper(deps: KeeperDeps) {
  let inflight: Promise<ServerConfig | null> | null = null

  async function rotate(config: ServerConfig, auth: OAuthAuth): Promise<ServerConfig | null> {
    const next = await (deps.refresh ?? refreshAuth)(config.baseUrl, auth)
    const current = deps.getConfig()

    // Signed out (or signed in to something else) while the request was in the air: that wins.
    if (!current || current.auth.kind !== 'oauth' || current.auth.refreshToken !== auth.refreshToken) {
      return current
    }

    const updated: ServerConfig = { baseUrl: config.baseUrl, auth: next }
    await deps.apply(updated)

    return updated
  }

  /**
   * The current config with an access token good for at least a couple of minutes, refreshing first
   * if needed. `force` refreshes regardless (the server rejected the token early). Rejects with
   * `SignInError` when the refresh fails; `expired` means the user has to sign in again.
   */
  async function fresh(force = false): Promise<ServerConfig | null> {
    const config = deps.getConfig()

    if (!config || config.auth.kind !== 'oauth') {
      return config
    }

    if (!force && !needsRefresh(config.auth, deps.nowS(), REFRESH_SKEW_S)) {
      return config
    }

    inflight ??= rotate(config, config.auth).finally(() => {
      inflight = null
    })

    return inflight
  }

  return { fresh }
}
