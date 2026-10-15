/**
 * Routines (Hermes cron jobs): the REST calls and the wording for them. Pure: no React Native imports.
 *
 * A bot's jobs live in its own profile, so every call names the bot. The server stores a run as an ordinary session
 * whose id starts `cron_<job id>_`; it is listed here but never resumed (resuming would disturb a finished run).
 */

import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

export interface CronSchedule {
  kind?: 'once' | 'interval' | 'cron' | (string & {})
  /** `cron`: the five-field expression. */
  expr?: string
  /** `interval`: minutes between runs. */
  minutes?: number
  /** `once`: ISO time. */
  run_at?: string
  display?: string
}

export interface CronJob {
  id: string
  name: string
  prompt?: string
  /** Skills loaded before the prompt (`hermes-dashboard:dashboard` for a dashboard routine). */
  skills?: string[] | null
  skill?: string | null
  schedule?: CronSchedule
  schedule_display?: string
  enabled?: boolean
  /** `scheduled`, `paused`, `completed`, `error`. */
  state?: string
  /** ISO times with the server's offset. */
  next_run_at?: string | null
  last_run_at?: string | null
  /** `ok` or `error`; null until it has run. */
  last_status?: string | null
  last_error?: string | null
  last_delivery_error?: string | null
  failure_streak?: number
}

/** One run of a job: a stored session. Times are epoch seconds. */
export interface CronRun {
  id: string
  started_at?: number | null
  ended_at?: number | null
  /** `cron_complete` for a healthy run; anything else means it did not finish with an answer. */
  end_reason?: string | null
  message_count?: number
  preview?: string
}

export type RunOutcome = 'ok' | 'failed' | 'running'

const jobPath = (id: string, profile: string, tail = '') => `/api/cron/jobs/${encodeURIComponent(id)}${tail}?profile=${encodeURIComponent(profile)}`

export async function listCronJobs(config: ServerConfig, profile: string): Promise<CronJob[]> {
  const jobs = await restJson<unknown>(config, `/api/cron/jobs?profile=${encodeURIComponent(profile)}`)

  return Array.isArray(jobs) ? (jobs as CronJob[]).filter(job => typeof job?.id === 'string') : []
}

export async function listCronRuns(config: ServerConfig, profile: string, id: string, limit = 20): Promise<CronRun[]> {
  const body = await restJson<{ runs?: CronRun[] }>(config, `${jobPath(id, profile, '/runs')}&limit=${limit}`)

  return Array.isArray(body?.runs) ? body.runs : []
}

export const pauseCronJob = (config: ServerConfig, profile: string, id: string) => restJson<CronJob>(config, jobPath(id, profile, '/pause'), { method: 'POST' })

export const resumeCronJob = (config: ServerConfig, profile: string, id: string) => restJson<CronJob>(config, jobPath(id, profile, '/resume'), { method: 'POST' })

export const deleteCronJob = (config: ServerConfig, profile: string, id: string) => restJson<{ ok: boolean }>(config, jobPath(id, profile), { method: 'DELETE' })

/** How long to wait for "Run now" to answer: the server replies only when the run has finished. */
export const TRIGGER_WAIT_MS = 10_000

/**
 * Starts a run. The server holds the request until the job finishes, which can be minutes, so this waits a few
 * seconds and then lets go: the run carries on without us. Returns `started` either way; `busy` when the server
 * says the job is already running (409).
 */
export async function triggerCronJob(config: ServerConfig, profile: string, id: string, waitMs = TRIGGER_WAIT_MS): Promise<'started' | 'busy'> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), waitMs)

  try {
    await restJson(config, jobPath(id, profile, '/trigger'), { method: 'POST', signal: abort.signal })

    return 'started'
  } catch (error) {
    if (error instanceof HermesHttpError && error.status === 409) {
      return 'busy'
    }

    // Our own timeout: the run is under way, we just stopped listening.
    if (abort.signal.aborted) {
      return 'started'
    }

    throw error
  } finally {
    clearTimeout(timer)
  }
}

// ── what a job is and how it went ────────────────────────────────────────────────────────────────

export type JobState = 'failed' | 'paused' | 'done' | 'waiting'

/** Whether the job's newest run went wrong, whether or not the routine is paused now. */
export const lastRunFailed = (job: CronJob): boolean => job.last_status === 'error' || job.state === 'error'

/** `paused` when switched off, else `failed` when the last run errored, `done` when a one-off has run, else `waiting`. */
export function jobState(job: CronJob): JobState {
  if (job.enabled === false || job.state === 'paused') {
    return 'paused'
  }

  if (lastRunFailed(job)) {
    return 'failed'
  }

  return job.state === 'completed' ? 'done' : 'waiting'
}

export const isOn = (job: CronJob): boolean => jobState(job) !== 'paused'

/** Failed routines first (they want attention), then the ones that are on, then paused; by name within each. */
export function sortJobs(jobs: CronJob[]): CronJob[] {
  const rank: Record<JobState, number> = { failed: 0, waiting: 1, done: 1, paused: 2 }

  return [...jobs].sort((a, b) => rank[jobState(a)] - rank[jobState(b)] || a.name.localeCompare(b.name))
}

/**
 * How a run went. Hermes 0.21.6 gives a run no outcome of its own (its session row has no `end_reason`): only the job
 * says how its LAST run went, so pass `lastRunFailed` for a job's newest run when `last_status` is `error`. Older
 * Hermes versions did record `end_reason`; when it is there, anything but `cron_complete` is a failure.
 */
export function runOutcome(run: CronRun, lastRunFailed = false): RunOutcome {
  if (!run.ended_at) {
    return 'running'
  }

  if (lastRunFailed || (run.end_reason && run.end_reason !== 'cron_complete')) {
    return 'failed'
  }

  return 'ok'
}

// ── wording ──────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

const pad = (n: number) => String(n).padStart(2, '0')

/** `14:05` → `2:05 PM`. */
export function clock(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12

  return `${h}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`
}

const timeOf = (date: Date) => clock(date.getHours(), date.getMinutes())

function ordinal(n: number): string {
  const tail = n % 100

  if (tail >= 11 && tail <= 13) {
    return `${n}th`
  }

  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** A five-field cron expression in words, or null when it is not one of the common shapes (the caller shows it raw). */
export function describeCron(expr: string): string | null {
  const fields = expr.trim().split(/\s+/)

  if (fields.length !== 5) {
    return null
  }

  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  const whole = (s: string) => (/^\d+$/.test(s) ? Number(s) : null)
  const everyMinute = /^\*\/(\d+)$/.exec(minute)

  if (dom === '*' && month === '*' && dow === '*' && hour === '*') {
    if (minute === '*' || (everyMinute && Number(everyMinute[1]) === 1)) {
      return 'Every minute'
    }

    if (everyMinute) {
      return `Every ${everyMinute[1]} minutes`
    }

    const m = whole(minute)

    return m === null ? null : m === 0 ? 'Every hour' : `Every hour at :${pad(m)}`
  }

  const m = whole(minute)

  if (m === null) {
    return null
  }

  const everyHours = /^\*\/(\d+)$/.exec(hour)

  if (everyHours && m === 0 && dom === '*' && month === '*' && dow === '*') {
    return `Every ${everyHours[1]} hours`
  }

  const span = /^(\d+)-(\d+)$/.exec(hour)

  if (span && dom === '*' && month === '*' && dow === '*') {
    const from = Number(span[1])
    const to = Number(span[2])

    if (from <= 23 && to <= 23 && from < to && m <= 59) {
      return `Every hour${m === 0 ? '' : ` at :${pad(m)}`}, ${clock(from, 0)} to ${clock(to, 0)}`
    }

    return null
  }

  const h = whole(hour)

  if (h === null || h > 23 || m > 59) {
    return null
  }

  const at = clock(h, m)

  if (month === '*' && dom === '*') {
    if (dow === '*') {
      return `Every day at ${at}`
    }

    if (dow === '1-5') {
      return `Weekdays at ${at}`
    }

    if (dow === '0,6' || dow === '6,0') {
      return `Weekends at ${at}`
    }

    const days = dow.split(',').map(whole)

    if (days.every(day => day !== null && day >= 0 && day <= 7)) {
      return `${list(days.map(day => WEEKDAYS[(day as number) % 7] as string))} at ${at}`
    }

    return null
  }

  const day = whole(dom)

  if (month === '*' && dow === '*' && day !== null && day >= 1 && day <= 31) {
    return `Monthly on the ${ordinal(day)} at ${at}`
  }

  return null
}

/** "Today, 2:00 AM", "Yesterday, 2:00 AM", "Oct 6, 2:00 AM". */
export function whenLabel(at: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days === -1 ? 'Tomorrow' : `${MONTHS[at.getMonth()]} ${at.getDate()}`

  return `${day}, ${timeOf(at)}`
}

/** "in 5 min", "in 3 hours", "in 2 days"; null when it is not in the future. */
export function inAbout(ms: number): string | null {
  if (!(ms > 0)) {
    return null
  }

  if (ms < 45_000) {
    return 'in under a minute'
  }

  const minutes = Math.round(ms / 60_000)

  if (minutes < 60) {
    return `in ${minutes} min`
  }

  const hours = Math.round(minutes / 60)

  if (hours < 36) {
    return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }

  const days = Math.round(hours / 24)

  return `in ${days} days`
}

/** "3m 12s", "45s", "1h 05m", "<1s". */
export function durationLabel(seconds: number): string {
  if (!(seconds >= 1)) {
    return '<1s'
  }

  const total = Math.round(seconds)

  if (total < 60) {
    return `${total}s`
  }

  if (total < 3600) {
    return `${Math.floor(total / 60)}m ${pad(total % 60)}s`
  }

  return `${Math.floor(total / 3600)}h ${pad(Math.floor((total % 3600) / 60))}m`
}

/** "Every day at 2:00 AM", "Every 30 minutes", "Once, Oct 12, 3:00 PM"; the server's own text when it is unfamiliar. */
export function describeSchedule(job: CronJob, now: Date = new Date()): string {
  const schedule = job.schedule
  const raw = (job.schedule_display || schedule?.display || schedule?.expr || '').trim()

  if (schedule?.kind === 'interval' && typeof schedule.minutes === 'number' && schedule.minutes > 0) {
    const minutes = schedule.minutes

    if (minutes % 1440 === 0) {
      return minutes === 1440 ? 'Every day' : `Every ${minutes / 1440} days`
    }

    if (minutes % 60 === 0) {
      return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} hours`
    }

    return minutes === 1 ? 'Every minute' : `Every ${minutes} minutes`
  }

  if (schedule?.kind === 'once' || (!schedule?.kind && schedule?.run_at)) {
    const at = schedule?.run_at ? new Date(schedule.run_at) : null

    return at && !Number.isNaN(at.getTime()) ? `Once, ${whenLabel(at, now)}` : raw || 'Once'
  }

  const words = schedule?.expr ? describeCron(schedule.expr) : raw ? describeCron(raw) : null

  if (words) {
    return words
  }

  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'No schedule'
}

/** The quiet line under a routine's name: its schedule, plus when it next runs or that it is paused. */
export function routineLine(job: CronJob, now: Date = new Date()): string {
  const base = describeSchedule(job, now)
  const state = jobState(job)

  if (state === 'paused') {
    return `${base} · Paused`
  }

  const next = job.next_run_at ? new Date(job.next_run_at) : null
  const soon = next && !Number.isNaN(next.getTime()) ? inAbout(next.getTime() - now.getTime()) : null

  return soon && job.schedule?.kind !== 'once' ? `${base} · next ${soon}` : base
}

/** "Last run failed · 4h ago": the red line on a routine whose last run went wrong. */
export function failedLine(job: CronJob, now: Date = new Date()): string {
  const at = job.last_run_at ? new Date(job.last_run_at) : null

  if (!at || Number.isNaN(at.getTime())) {
    return 'Last run failed'
  }

  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000))
  const ago = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`

  return `Last run failed · ${ago}`
}

/** What to write in the chat box for "Ask <bot> why": the routine, when it failed and the server's reason. */
export function askWhyDraft(job: CronJob, now: Date = new Date()): string {
  const at = job.last_run_at ? new Date(job.last_run_at) : null
  const when = at && !Number.isNaN(at.getTime()) ? ` ${whenLabel(at, now).replace(/^Today, /, 'today at ').replace(/^Yesterday, /, 'yesterday at ')}` : ''
  const reason = (job.last_error || job.last_delivery_error || '').trim().replace(/\s+/g, ' ').slice(0, 300)

  return `Why did the routine “${job.name}” fail${when}?${reason ? ` It said: ${reason}` : ''}`
}

export const NEW_ROUTINE_DRAFT = 'Set up a routine that '
