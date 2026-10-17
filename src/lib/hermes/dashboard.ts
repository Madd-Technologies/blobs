/**
 * Bot dashboards (the optional hermes-dashboard plugin, 0.2+): collections each bot designs and keeps for you, shown as
 * panels. The server computes every view, so the app only draws what it is given and formats values by their field type.
 * You act on records here (status, fields, notes, done); bots create records and views. Pure apart from the fetches.
 */

import { isAbsent } from './plugins.ts'
import { restJson, type ServerConfig } from './server.ts'

const BASE = '/api/plugins/hermes-dashboard'

export type FieldType = 'text' | 'longtext' | 'number' | 'money' | 'percent' | 'date' | 'datetime' | 'checkbox' | 'status' | 'choice' | 'phone' | 'email' | 'url' | 'link' | 'rating' | 'draft'

export interface Field {
  key: string
  label: string
  type: FieldType
  required?: boolean
  retired?: boolean
  /** status: ordered stages; the done ones close a record. */
  stages?: { name: string; done: boolean }[]
  /** choice */
  options?: string[]
  /** money */
  currency?: string
  /** draft: the key of the field naming who it is for. */
  to?: string
}

/** A button's job under way: pressed at `at` (server seconds), running in the side chat `session` until the bot writes the record. */
export interface RunningJob {
  action: string
  label: string
  session: string | null
  at: number
}

/** A value with its type, as the server hands it over for drawing. `datetime` values are epoch seconds; `date` is YYYY-MM-DD. */
export interface Typed {
  key: string
  type: FieldType
  value: string | number | boolean
  currency?: string
}

/** A row's signal from its view's `signals` rules (hermes-dashboard 0.4.0): a small green, amber or red dot. */
export type RowSignal = 'good' | 'warn' | 'bad'

export interface ViewRow {
  id: string
  done: boolean
  needs_you: boolean
  /** The first of the view's signal rules this row matches; absent when none does, or it is done or muted. */
  signal?: RowSignal
  /** Set while you have it muted: when it speaks up again (server seconds). */
  muted_until?: number
  /** A url the row opens (a live panel's `show.link`). */
  link?: Typed
  title?: Typed
  subtitle?: Typed
  meta?: Typed
}

/** How a collection is kept fresh, as its bot recorded it. */
export interface Feed {
  how: 'script' | 'model_on_change' | 'model_timer'
  job?: string
  every?: string
  note?: string
}

/** How a panel stays fresh: it reads a live source, it is computed from a collection (with that collection's feed), or
 * its bot writes it. */
export type Kept = { how: 'live'; kind: 'sqlite' | 'json' | 'ics' | 'script'; ttl: number } | { how: 'computed'; feed?: Feed } | { how: 'written' }

interface ViewBase {
  id: string
  title: string
  kept?: Kept
  /** A live panel's last read (server seconds), and the error when the latest read failed (the rows are then from as_of). */
  live?: { as_of: number | null; error?: string }
  /** `owner/id` of the collection it shows; null for summary and stat. */
  collection: string | null
  updated?: number
  open?: number
  needs_you?: number
}

export type View =
  | (ViewBase & { kind: 'list' | 'checklist'; rows: ViewRow[] })
  | (ViewBase & { kind: 'table'; columns: { key: string; label: string; type: FieldType }[]; rows: { id: string; done: boolean; needs_you: boolean; signal?: RowSignal; muted_until?: number; cells: (Typed | null)[] }[] })
  | (ViewBase & { kind: 'board'; columns: { name: string; count: number; rows: ViewRow[] }[] })
  | (ViewBase & { kind: 'number'; value: number | null; previous?: number | null; period?: 'day' | 'week' | 'month' })
  | (ViewBase & { kind: 'chart'; bucket: 'day' | 'week' | 'month'; style: 'bar' | 'line'; points: { start: string; value: number }[] })
  | (ViewBase & { kind: 'summary'; text: string })
  | (ViewBase & { kind: 'stat'; metrics: { label: string; value: string; change?: string }[] })

export interface BotDashboard {
  profile: string
  /** Changes whenever anything on this dashboard could have; sent back as `since` to skip an unchanged read. */
  version?: string
  views: View[]
  collections: Record<string, { title: string; owner: string; fields: Field[] }>
  /** The server's clock (epoch seconds). */
  now: number
  /** Whether this bot has the plugin in its own profile (0.3.1+); null when the server can't tell, absent before 0.3.1. */
  installed?: boolean | null
}

export interface DashboardsSummary {
  bots: Record<string, { needs_you: number; views?: number; updated: number }>
  now: number
}

export interface DashboardRecord {
  id: string
  collection: string
  source_key: string | null
  values: Record<string, string | number | boolean | null>
  /** Fields you changed last, and when: bots leave them alone. */
  person_fields: Record<string, number>
  created_by: string
  created_at: number
  updated_at: number
  closed_at: number | null
  running?: RunningJob | null
  /** When a mute you set lifts (server seconds); null or past when not muted. */
  muted_until?: number | null
}

export interface HistoryEntry {
  at: number
  by_kind: 'bot' | 'person'
  /** The bot's profile, or "you". */
  by: string
  /** A field key, or `_created`, `_note`, `_closed`, `_reopened`. */
  field: string
  old: unknown
  new: unknown
}

export interface RecordDetail {
  record: DashboardRecord
  collection: { key: string; owner: string; id: string; title: string; fields: Field[] }
  history: HistoryEntry[]
  /** How to head it: the fields its first view shows, a longtext body, and whether a view's rule says it needs you. */
  show?: {
    title: string | null
    subtitle: string | null
    meta: string | null
    body: string | null
    needs_you: boolean
    view: string | null
    /** The buttons this record offers now; the first is its white pill. */
    actions?: { id: string; label: string }[]
    /** The pressed button it waits on, if any. */
    running?: RunningJob | null
  }
  now: number
}

export interface NeedsYouRecord {
  view: string
  view_title: string
  row: ViewRow
}

/** The server runs 0.1 (snapshot panels), which this app no longer draws. */
export class OldDashboardPlugin extends Error {
  constructor() {
    super('The Dashboards plugin on your server is an older version. Update it from Server plugins.')
  }
}

async function orNull<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call()
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}

export function getDashboardsSummary(config: ServerConfig): Promise<DashboardsSummary | null> {
  return orNull(async () => {
    const answer = await restJson<DashboardsSummary>(config, `${BASE}/bots`, {}, { timeoutMs: 8000 })

    return answer && typeof answer.bots === 'object' && answer.bots ? answer : null
  })
}

/** A bot's dashboard, or `'unchanged'` when `since` is its current version (plugin 0.3+). `fresh` reads live sources now. */
export function getBotDashboard(config: ServerConfig, profile: string, options: { since?: string; fresh?: boolean } = {}): Promise<BotDashboard | 'unchanged' | null> {
  return orNull(async () => {
    const query = [options.since ? `since=${encodeURIComponent(options.since)}` : '', options.fresh ? 'fresh=1' : ''].filter(Boolean).join('&')
    const answer = await restJson<BotDashboard & { panels?: unknown; unchanged?: boolean }>(config, `${BASE}/bots/${encodeURIComponent(profile)}${query ? `?${query}` : ''}`, {}, { timeoutMs: 10000 })

    if (answer?.unchanged) {
      return 'unchanged' as const
    }

    if (answer && Array.isArray(answer.panels) && !Array.isArray(answer.views)) {
      throw new OldDashboardPlugin()
    }

    return answer && Array.isArray(answer.views) ? { ...answer, collections: answer.collections ?? {} } : null
  })
}

export async function getNeedsYou(config: ServerConfig, profile: string): Promise<{ records: NeedsYouRecord[]; now: number }> {
  const answer = await orNull(() => restJson<{ records?: NeedsYouRecord[]; now?: number }>(config, `${BASE}/bots/${encodeURIComponent(profile)}/needs-you`, {}, { timeoutMs: 8000 }))

  return { records: Array.isArray(answer?.records) ? answer.records : [], now: answer?.now ?? 0 }
}

const recordPath = (id: string, tail = '') => `${BASE}/records/${encodeURIComponent(id)}${tail}`

export function getRecord(config: ServerConfig, id: string): Promise<RecordDetail> {
  return restJson<RecordDetail>(config, recordPath(id), {}, { timeoutMs: 10000 })
}

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

/** Your changes to a record's fields. Answers the record as it is now. */
export async function changeRecord(config: ServerConfig, id: string, values: Record<string, unknown>): Promise<DashboardRecord> {
  return (await restJson<{ record: DashboardRecord }>(config, recordPath(id), json('PATCH', { values }), { timeoutMs: 10000 })).record
}

export async function setRecordClosed(config: ServerConfig, id: string, closed: boolean): Promise<DashboardRecord> {
  return (await restJson<{ record: DashboardRecord }>(config, recordPath(id, closed ? '/close' : '/reopen'), json('POST'), { timeoutMs: 10000 })).record
}

export function addRecordNote(config: ServerConfig, id: string, text: string): Promise<{ note: string; at: number }> {
  return restJson(config, recordPath(id, '/notes'), json('POST', { text }), { timeoutMs: 10000 })
}

/** Mutes a record until `until` (server seconds), or unmutes it with null. */
export async function muteRecord(config: ServerConfig, id: string, until: number | null): Promise<DashboardRecord> {
  return (await restJson<{ record: DashboardRecord }>(config, recordPath(id, '/mute'), json('POST', { until }), { timeoutMs: 10000 })).record
}

/** You pressed a button on a record: the server marks it under way and answers the message to send the bot in `session`. */
export function pressAction(config: ServerConfig, id: string, action: string, session: string | null): Promise<{ message: string; running: RunningJob }> {
  return restJson(config, recordPath(id, `/actions/${encodeURIComponent(action)}`), json('POST', { session }), { timeoutMs: 10000 })
}

/** The plugin's own status route: whether it is loaded, and its version. Null when it is not there. */
export function getDashboardStatus(config: ServerConfig): Promise<{ version: string; bots: number } | null> {
  return orNull(async () => {
    const status = await restJson<{ version: string; bots: number }>(config, `${BASE}/status`)

    return typeof status?.version === 'string' ? status : null
  })
}
