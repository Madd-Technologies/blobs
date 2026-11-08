/**
 * Polling a route of an optional server plugin that may not be installed. Blobs works without every plugin, so a timer
 * that keeps asking a plugin the server does not have only wastes requests (and battery). Once the plugin is found
 * missing, the timer asks again only every so often, which still notices an install without a reconnect. Pure.
 */

/** How often a missing plugin is asked about again. */
export const ABSENT_RECHECK_MS = 10 * 60_000

export interface AbsentGate {
  /** Whether to ask now: always while the plugin is there or not yet known, now and then while it is missing. */
  due: () => boolean
  /** What the last ask found: the plugin answered (true) or is not installed (false). */
  seen: (present: boolean) => void
  /** Ask at the next tick whatever was found before (a reconnect, another server). */
  reset: () => void
  /** Whether the last ask found the plugin missing. */
  missing: () => boolean
}

export function absentGate(everyMs: number = ABSENT_RECHECK_MS, now: () => number = Date.now): AbsentGate {
  let missingSince: number | null = null

  return {
    due: () => missingSince === null || now() - missingSince >= everyMs,
    seen: present => {
      missingSince = present ? null : now()
    },
    reset: () => {
      missingSince = null
    },
    missing: () => missingSince !== null,
  }
}
