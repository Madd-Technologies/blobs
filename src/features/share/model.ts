/**
 * Sharing what the file viewer shows (canvas row 25): Taildrop from the server, and share from this phone. What the
 * device sheet lists and what the header's line says. Pure.
 */

import type { TaildropStatus, TaildropTarget } from '../../lib/hermes/taildrop.ts'

/** "34 MB", "512 KB", "12 B". */
export function sizeLabel(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return ''
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  const mb = bytes / 1024 / 1024

  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

/** "12 of 34 MB", or just "12 MB" before the size is known. */
export function progressLabel(done: number | null | undefined, total: number | null | undefined): string {
  if (!total) {
    return sizeLabel(done ?? 0)
  }

  // One unit for both, the larger one's.
  const unit = total >= 1024 * 1024 ? 1024 * 1024 : total >= 1024 ? 1024 : 1
  const name = unit === 1 ? 'B' : unit === 1024 ? 'KB' : 'MB'
  const of = (value: number) => (unit === 1024 * 1024 && total < 10 * unit ? (value / unit).toFixed(1) : String(Math.round(value / unit)))

  return `${of(Math.min(done ?? 0, total))} of ${of(total)} ${name}`
}

export type DeviceIcon = 'smartphone' | 'monitor' | 'hard-drive' | 'tablet'

/** One row of the device sheet. */
export interface DeviceRow {
  target: TaildropTarget
  /** "This phone", or the device's name. */
  title: string
  line: string
  icon: DeviceIcon
  /** Offline or not taking files: drawn dim, not tappable. */
  disabled: boolean
  /** The device sent to last from here. */
  last: boolean
}

/** Read the CLI's words about a device: "offline; last seen 3h12m0s ago" → "Offline · seen 3 h ago". */
export function deviceLine(target: TaildropTarget, extra?: string): string {
  const detail = target.detail ?? ''

  if (!target.online || /offline/i.test(detail)) {
    const seen = /last seen ([0-9hms.]+) ago/i.exec(detail)?.[1]

    return seen ? `Offline · seen ${roughAgo(seen)} ago` : 'Offline'
  }

  if (detail) {
    return /not accepting|no file sharing|disabled/i.test(detail) ? 'That device isn’t accepting files' : detail
  }

  return extra ?? ''
}

/** "3h12m0s" → "3 h", "45m10s" → "45 min", "20s" → "a moment". */
function roughAgo(duration: string): string {
  const hours = Number(/(\d+)h/.exec(duration)?.[1] ?? 0)
  const minutes = Number(/(\d+)m(?!s)/.exec(duration)?.[1] ?? 0)

  if (hours >= 48) {
    return `${Math.floor(hours / 24)} d`
  }

  return hours ? `${hours} h` : minutes ? `${minutes} min` : 'a moment'
}

function iconFor(target: TaildropTarget, os: string | null | undefined): DeviceIcon {
  const words = `${target.name} ${os ?? ''}`.toLowerCase()

  if (/nas|storage|synology|unraid|truenas/.test(words)) {
    return 'hard-drive'
  }

  if (/ipad|tablet/.test(words)) {
    return 'tablet'
  }

  return /phone|pixel|galaxy|android|ios|fold/.test(words) ? 'smartphone' : 'monitor'
}

/**
 * The device sheet: this phone first, then the device you sent to last, then the rest online before offline, each
 * group in the CLI's order. `lastTarget`: the name of the last device sent to from here.
 */
export function deviceRows(status: TaildropStatus, lastTarget: string | null): DeviceRow[] {
  const rank = (target: TaildropTarget) => (target.you ? 0 : target.name === lastTarget ? 1 : target.online ? 2 : 3)
  const sorted = status.targets.map((target, index) => ({ target, index })).sort((a, b) => rank(a.target) - rank(b.target) || a.index - b.index)

  return sorted.map(({ target }) => {
    // This phone reads as "This phone", with its own name under it; the device sent to last says so.
    const line = deviceLine(target, target.you ? target.name : target.name === lastTarget ? 'Last used' : '')
    const disabled = !target.online || /isn’t accepting/.test(line)

    return { target, title: target.you ? 'This phone' : target.name, line, icon: target.you ? 'smartphone' : iconFor(target, null), disabled, last: target.name === lastTarget }
  })
}

/** How long ago an offline device was last seen, in hours, from the CLI's "last seen 3h12m0s ago"; null when it doesn't say. */
export function seenHoursAgo(target: TaildropTarget): number | null {
  const duration = /last seen ([0-9hms.]+) ago/i.exec(target.detail ?? '')?.[1]

  if (!duration) {
    return null
  }

  return Number(/(\d+)h/.exec(duration)?.[1] ?? 0) + Number(/(\d+)m(?!s)/.exec(duration)?.[1] ?? 0) / 60
}

/** Devices offline for longer than this are folded away under one row: a tailnet keeps old devices for years. */
export const STALE_HOURS = 7 * 24

/** The rows to show at once, and the ones offline for over a week (shown on request). */
export function splitStale(rows: readonly DeviceRow[]): { shown: DeviceRow[]; stale: DeviceRow[] } {
  const isStale = (row: DeviceRow) => !row.target.you && !row.last && !row.target.online && (seenHoursAgo(row.target) ?? Infinity) > STALE_HOURS

  return { shown: rows.filter(row => !isStale(row)), stale: rows.filter(isStale) }
}

/** "Sent to MacBook · it’s in Tailscale’s notification there" (this phone: "on this phone"). */
export function sentToast(target: TaildropTarget): string {
  return target.you ? 'Sent to this phone · it’s in Tailscale’s notification' : `Sent to ${target.name} · it’s in Tailscale’s notification there`
}

/** A failed send, said quietly: what the CLI said, shortened, or that the device went away. */
export function sendFailure(target: string, error: string | null | undefined): string {
  const words = (error ?? '').trim()

  if (/offline|not replying|no route|timed out|timeout/i.test(words)) {
    return `${target} went offline`
  }

  if (/access denied|operator/i.test(words)) {
    return 'the server needs one setup step'
  }

  return words ? (words.split('\n')[0] ?? words).slice(0, 80) : 'it stopped part way'
}

/** A failed download for sharing, said quietly. */
export function getFailure(status: number | null): string {
  return status ? `the server said ${status}` : 'the connection dropped'
}
