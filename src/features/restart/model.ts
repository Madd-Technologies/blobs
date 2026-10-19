/**
 * What the Settings row, the restart sheet and the restarting screen say, from the plugin's restart status (canvas row 24).
 * Pure.
 */

import type { RestartBusy, RestartEntry, RestartStatus } from '../../lib/hermes/restart.ts'

export type RestartChoice = 'dashboard' | 'gateway' | 'both'

/** What the app itself is doing about a restart it asked for. */
export type RestartPhase =
  /** Nothing asked from here, or it is over. */
  | { kind: 'idle' }
  /** Asked; the dashboard (and the gateway first, for Both) restart now. `before`: the process that was running. */
  | { kind: 'restarting'; before: number | null; since: number; choice: RestartChoice; waited: string[] }

/** The plugin's outcomes for a request still being carried out. */
const UNDER_WAY = new Set(['waiting', 'restarting_gateway', 'scheduling', 'scheduled'])
/** How recent a failed or timed-out request must be for the row to still mention it (s). */
const RECENT_S = 6 * 60 * 60

export interface RowView {
  line: string
  /** `quiet`: the usual secondary color; `text`: something you might do; `amber`: it waits on you. */
  tone: 'quiet' | 'text' | 'amber'
  spinner: boolean
  /** A right-hand word: Cancel (the wait) or Update (the plugin). */
  action?: 'cancel' | 'update'
  /** Where a tap goes: the sheet, Server plugins, or nowhere. */
  opens: 'sheet' | 'plugins' | null
}

/** A plugin installed but not loaded yet: it loads at the next restart. */
export interface WaitingPlugin {
  title: string
  version: string | null
}

export function clockLabel(epochS: number, now: Date = new Date()): string {
  const when = new Date(epochS * 1000)
  const sameDay = when.toDateString() === now.toDateString()
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return sameDay ? time : `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

/** "up 12 min", "up 5 h", "up 3 days". */
export function uptime(startedAt: number, now: number): string {
  const seconds = Math.max(0, now - startedAt)

  if (seconds < 3600) {
    return `up ${Math.max(1, Math.floor(seconds / 60))} min`
  }

  if (seconds < 86_400) {
    return `up ${Math.floor(seconds / 3600)} h`
  }

  const days = Math.floor(seconds / 86_400)

  return `up ${days} ${days === 1 ? 'day' : 'days'}`
}

/** "2 bots", "1 bot". */
export const bots = (count: number) => `${count} ${count === 1 ? 'bot' : 'bots'}`

/** The request still being carried out, if any. */
export function underWay(status: RestartStatus | null | undefined): RestartEntry | null {
  return status?.last && UNDER_WAY.has(status.last.outcome) ? status.last : null
}

/** When this dashboard last came back from a restart: the logged one, else its own start. */
export function lastRestarted(status: RestartStatus): number | null {
  return status.last?.outcome === 'done' && status.last.restarted_at ? status.last.restarted_at : status.started_at
}

/** One busy chat as the sheet lists it: the bot's name and what it is doing. */
export interface BusyRow {
  id: string
  profile: string | null
  name: string
  line: string
  waitingOnYou: boolean
}

export function busyRows(busy: readonly RestartBusy[] | null | undefined, nameOf: (profile: string | null) => string): BusyRow[] {
  return (busy ?? []).map(row => ({
    id: row.id,
    profile: row.profile,
    name: nameOf(row.profile),
    // A bot's main chat is "Bot Chat" on the server; a room member's hidden chat is "Group: <room>".
    line: !row.title || row.title === 'Bot Chat' ? 'In its chat' : row.title.startsWith('Group: ') ? 'In a group room' : row.title,
    waitingOnYou: row.status === 'waiting',
  }))
}

/** "Concierge is working", "Concierge and Forge are working", "3 bots are working". */
export function workingLine(names: readonly string[]): string {
  if (names.length === 0) {
    return ''
  }

  if (names.length === 1) {
    return `${names[0]} is working`
  }

  return names.length === 2 ? `${names[0]} and ${names[1]} are working` : `${bots(names.length)} are working`
}

/** Restarting the gateway alone, or with the dashboard, needs Hermes's own gateway restart. */
export const gatewayRestartable = (status: RestartStatus) => status.gateway.route && status.gateway.same_unit !== true

/** Both while a plugin waits to load (a plugin needs the dashboard and the gateway), else the dashboard. */
export function defaultChoice(status: RestartStatus, waiting: WaitingPlugin | null): RestartChoice {
  return waiting && gatewayRestartable(status) ? 'both' : 'dashboard'
}

/**
 * The Settings row. `status`: undefined while unread, null when the plugin has no restart route. `phase`: what the app
 * asked. `dismissedTimeout`: the id of a timed-out request already seen, which stops reading as amber.
 */
export function rowView(input: {
  status: RestartStatus | null | undefined
  phase: RestartPhase
  waiting: WaitingPlugin | null
  now: number
  nameOf: (profile: string | null) => string
  dismissedTimeout?: string | null
  clock?: (epochS: number) => string
}): RowView {
  const { status, phase, waiting, now, nameOf } = input
  const clock = input.clock ?? (epochS => clockLabel(epochS))

  if (phase.kind === 'restarting') {
    return { line: 'Restarting… reconnects by itself', tone: 'quiet', spinner: true, opens: null }
  }

  if (status === undefined) {
    return { line: 'Checking…', tone: 'quiet', spinner: false, opens: null }
  }

  if (status === null) {
    return { line: 'Needs HermesBot 0.1.7 on the server', tone: 'quiet', spinner: false, action: 'update', opens: 'plugins' }
  }

  if (!status.supported) {
    return { line: status.why ?? 'This Hermes can’t restart itself from the app. Restart it where it runs.', tone: 'quiet', spinner: false, opens: null }
  }

  const going = underWay(status)

  if (going?.outcome === 'waiting') {
    const count = status.busy?.length ?? going.busy_left ?? 0
    const minutes = Math.round((going.idle_timeout_s ?? 600) / 60)

    return { line: count ? `Waiting for ${bots(count)} to finish · up to ${minutes} min` : 'Waiting for the chats to finish', tone: 'quiet', spinner: true, action: 'cancel', opens: 'sheet' }
  }

  if (going) {
    return { line: 'Restarting… reconnects by itself', tone: 'quiet', spinner: true, opens: null }
  }

  const last = status.last
  const recent = last && now - (last.finished_at ?? last.requested_at) < RECENT_S

  if (last && recent && last.outcome === 'timed_out' && input.dismissedTimeout !== last.id) {
    const still = busyRows(status.busy, nameOf).map(row => row.name)
    const minutes = Math.round((last.idle_timeout_s ?? 600) / 60)

    return { line: `Still busy after ${minutes} min${still.length ? ` · ${workingLine(still)}` : ''}`, tone: 'amber', spinner: false, opens: 'sheet' }
  }

  if (last && recent && (last.outcome === 'failed' || last.outcome === 'not_restarted' || last.outcome === 'interrupted')) {
    return { line: `Last restart failed ${clock(last.finished_at ?? last.requested_at)} · see where it runs`, tone: 'quiet', spinner: false, opens: 'sheet' }
  }

  if (waiting) {
    return { line: `${waiting.title}${waiting.version ? ` ${waiting.version}` : ''} loads after a restart`, tone: 'text', spinner: false, opens: 'sheet' }
  }

  const restarted = lastRestarted(status)
  const parts = [status.started_at ? `Dashboard ${uptime(status.started_at, now)}` : '', restarted ? `last restarted ${clock(restarted)}` : '']

  return { line: parts.filter(Boolean).join(' · ') || 'Restart the dashboard and the gateway', tone: 'quiet', spinner: false, opens: 'sheet' }
}

/** Whether a reconnect after a restart reached a new dashboard process. */
export function cameBack(status: RestartStatus | null | undefined, before: number | null): boolean {
  return !!status?.started_at && (before === null || status.started_at > before + 0.5)
}
