/**
 * What the server's plugins push over `/api/ws` so the app need not ask on a timer (hermes-bot-mobile 0.2.0, hermes-dashboard
 * 0.7.0): rooms that moved, the members' turns in a room as they stream, dashboards whose version moved. And `PUT /watch`, which
 * tells the server what is on this phone's screen, so it reads live panels and streams room turns only for those.
 * Pure: no React Native imports.
 */

import type { RoomEvent } from './protocol.ts'
import { TURN_ENDS } from './rooms.ts'
import { restJson, type ServerConfig } from './server.ts'

export const ROOMS_CHANGED = 'plugin.hermes-bot-mobile.rooms.changed'
export const ROOM_LIVE = 'plugin.hermes-bot-mobile.room.live'
export const DASHBOARD_CHANGED = 'plugin.hermes-dashboard.changed'

const MOBILE = '/api/plugins/hermes-bot-mobile'
const DASHBOARD = '/api/plugins/hermes-dashboard'

/** One tool step of a member's turn so far. */
export interface LiveStep {
  id: string
  name: string
  done: boolean
  seconds?: number
}

/** A room member's turn as it streams: the end of its reply so far and its tool steps. */
export interface LiveTurn {
  turn: string
  phase: 'tool' | 'thinking' | 'writing' | 'approval' | 'error' | (string & {})
  tool: string | null
  text: string
  /** The start of a long reply was dropped (only its end is kept while it streams). */
  cut: boolean
  steps: LiveStep[]
  /** Server seconds. */
  started: number
  updated: number
}

export interface RoomLive {
  room_id: string
  members: Record<string, LiveTurn>
  /** Server seconds of the newest change. */
  at: number
}

export interface RoomMark {
  latest_seq: number
  revision: number
  updated_at: number
}

export interface DashboardChanged {
  /** Bots whose dashboard version moved, with the new version. */
  versions: Record<string, string>
  /** Each bot's needs-you count, panels and last change (what `GET /bots` answers), when the store was written. */
  summary?: Record<string, { needs_you: number; views?: number; updated: number }>
}

/** What the server pushes. Without a feature the app keeps asking on its own, as before. */
export interface PushFeatures {
  watch: boolean
  roomsChanged: boolean
  roomLive: boolean
  dashboardChanged: boolean
}

export const NO_PUSH: PushFeatures = { watch: false, roomsChanged: false, roomLive: false, dashboardChanged: false }

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export function parseRoomLive(payload: unknown): RoomLive | null {
  const body = record(payload)

  if (!body || typeof body.room_id !== 'string') {
    return null
  }

  const members: Record<string, LiveTurn> = {}

  for (const [memberId, raw] of Object.entries(record(body.members) ?? {})) {
    const entry = record(raw)

    if (!entry) {
      continue
    }

    members[memberId] = {
      turn: String(entry.turn ?? ''),
      phase: String(entry.phase ?? 'writing'),
      tool: typeof entry.tool === 'string' ? entry.tool : null,
      text: typeof entry.text === 'string' ? entry.text : '',
      cut: entry.cut === true,
      steps: (Array.isArray(entry.steps) ? entry.steps : []).flatMap(step => {
        const value = record(step)

        return value ? [{ id: String(value.id ?? ''), name: String(value.name ?? 'tool'), done: value.done === true, ...(typeof value.seconds === 'number' ? { seconds: value.seconds } : {}) }] : []
      }),
      started: num(entry.started),
      updated: num(entry.updated),
    }
  }

  return { room_id: body.room_id, members, at: num(body.at) }
}

export function parseRoomsChanged(payload: unknown): Record<string, RoomMark> | null {
  const rooms = record(record(payload)?.rooms)

  if (!rooms) {
    return null
  }

  return Object.fromEntries(
    Object.entries(rooms).flatMap(([id, raw]) => {
      const row = record(raw)

      return row ? [[id, { latest_seq: num(row.latest_seq), revision: num(row.revision), updated_at: num(row.updated_at) }]] : []
    }),
  )
}

export function parseDashboardChanged(payload: unknown): DashboardChanged | null {
  const body = record(payload)

  if (!body) {
    return null
  }

  const versions = Object.fromEntries(Object.entries(record(body.versions) ?? {}).flatMap(([bot, version]) => (typeof version === 'string' ? [[bot, version]] : [])))
  const summary = record(body.summary)

  return {
    versions,
    ...(summary
      ? {
          summary: Object.fromEntries(
            Object.entries(summary).flatMap(([bot, raw]) => {
              const row = record(raw)

              return row ? [[bot, { needs_you: num(row.needs_you), views: num(row.views), updated: num(row.updated) }]] : []
            }),
          ),
        }
      : {}),
  }
}

/** Hermes's reply for a member with nothing to add (`is_pass_text`): "(pass)", "pass." and the like. */
const PASS = /^\(?\s*pass\s*\)?\.?$/i

/** Whether a member's words so far are its pass, or the start of one ("(", "(pa"): never shown as a reply. */
export function isPassText(text: string): boolean {
  const words = text.trim()

  return PASS.test(words) || (words.startsWith('(') && '(pass)'.startsWith(words.toLowerCase()))
}

/** What a live turn has written so far, without a pass: Hermes throws that away, so it is no reply. */
export const liveWords = (turn: Pick<LiveTurn, 'text'>): string => (turn.text && !isPassText(turn.text) ? turn.text : '')

/**
 * A member's live turn is worth showing while it is the room's current work: not after the room log has that member's reply or
 * the end of its turn from when the turn started on (the finished message replaces it; a pass ends it with no message), and
 * not once it has been quiet for a long while.
 */
export function showLiveTurn(turn: LiveTurn, lastDoneAt: number | undefined, nowS: number): boolean {
  if (!liveWords(turn) && !turn.steps.length && turn.phase !== 'thinking' && turn.phase !== 'tool') {
    return false
  }

  if (lastDoneAt !== undefined && lastDoneAt >= turn.started) {
    return false
  }

  return nowS - turn.updated < 10 * 60
}

/**
 * When each member last posted a message or finished a turn in the room's log (server seconds), to hide a live turn that is
 * over. A turn's end names its member in the payload (the gateway logs it); a message's author is its actor.
 */
export function lastDoneBy(events: readonly Pick<RoomEvent, 'kind' | 'actor' | 'payload' | 'created_at'>[]): Record<string, number> {
  const last: Record<string, number> = {}

  for (const event of events) {
    const member = event.kind === 'message.member' ? event.actor?.id : TURN_ENDS.has(event.kind) && typeof event.payload?.member_id === 'string' ? event.payload.member_id : undefined

    if (member) {
      last[member] = Math.max(last[member] ?? 0, event.created_at)
    }
  }

  return last
}

async function featuresOf(config: ServerConfig, path: string): Promise<string[]> {
  try {
    const status = await restJson<{ features?: unknown }>(config, path, {}, { timeoutMs: 10_000 })

    return Array.isArray(status?.features) ? status.features.filter((feature): feature is string => typeof feature === 'string') : []
  } catch {
    return []
  }
}

/** Which pushes this server's plugins send (none when a plugin is missing or older). */
export async function getPushFeatures(config: ServerConfig): Promise<PushFeatures> {
  const [mobile, dashboard] = await Promise.all([featuresOf(config, `${MOBILE}/status`), featuresOf(config, `${DASHBOARD}/status`)])

  return {
    watch: mobile.includes('watch'),
    roomsChanged: mobile.includes('rooms.changed'),
    roomLive: mobile.includes('room.live'),
    dashboardChanged: dashboard.includes('changed'),
  }
}

export interface WatchSet {
  dashboards: string[]
  records: string[]
  rooms: string[]
  errands: string[]
}

/** Tells the server what is on this phone's screen now; it lasts `ttl` seconds unless sent again. */
export function putWatch(config: ServerConfig, client: string, watch: WatchSet, ttl = 90): Promise<unknown> {
  return restJson(config, `${MOBILE}/watch`, { method: 'PUT', body: JSON.stringify({ client, ...watch, ttl }) }, { timeoutMs: 10_000 })
}
