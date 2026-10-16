/**
 * What the connected Hermes can do that older ones cannot, from the version its public `/api/status` reports. Pure.
 */

import { compareVersions } from './plugins.ts'

/**
 * The first Hermes whose live work the app follows (`docs/protocol.md`, "Live work"): long commands become background jobs
 * instead of being refused, helpers always run in the background, and both report as they go. An older or unknown server keeps
 * every step's line exactly as it was.
 */
export const LIVE_WORK_SINCE = '0.22.0'

export function supportsLiveWork(version: string | null | undefined): boolean {
  return !!version && /^\d+\.\d+/.test(version) && compareVersions(version, LIVE_WORK_SINCE) >= 0
}
