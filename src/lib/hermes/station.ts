/**
 * Base-station endpoints on hermes-bot-mobile 0.4+: morning briefing activity, quiet hours,
 * fleet emergency pause/resume, usage telemetry, APNs status, and one-tap approval actions.
 * Pure apart from fetches; older plugin copies without a route return null cleanly.
 */

import { isAbsent } from './plugins.ts'
import { restJson, type ServerConfig } from './server.ts'

const BASE = '/api/plugins/hermes-bot-mobile'

export interface ActivityEvent {
  at: number
  kind: string
  profile: string
  summary: string
  status: string
  session?: string
  url?: string
}

export interface ActivityCounts {
  total: number
  completed: number
  failed: number
  approvals: number
  replies: number
  routines: number
}

export interface ActivitySummary {
  since: number
  now: number
  counts: ActivityCounts
  by_bot: Record<string, { total: number; completed: number; failed: number; latest_at: number }>
  events: ActivityEvent[]
}

export interface QuietHoursConfig {
  enabled: boolean
  start: string
  end: string
  timezone: string
  allow_urgent: boolean
  days: number[]
  muted_until: number | null
}

export interface FleetBot {
  profile: string
  name: string
  routines: number
  last_active: number | null
  paused: boolean
}

export interface FleetStatus {
  paused: boolean
  paused_at: number | null
  reason: string
  resumed_at: number | null
  bots: FleetBot[]
  now: number
}

export interface TelemetryDay {
  date: string
  sessions: number
  messages: number
  tokens: number
  cost_usd: number
}

export interface TelemetrySummary {
  days: number
  since: number
  now: number
  totals: {
    sessions: number
    messages: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cost_usd: number
  }
  by_bot: Record<
    string,
    {
      sessions: number
      messages: number
      input_tokens: number
      output_tokens: number
      total_tokens: number
      cost_usd: number
    }
  >
  by_model: Record<string, { sessions: number; tokens: number; cost_usd: number }>
  daily: TelemetryDay[]
}

export interface ApnsStatus {
  configured: boolean
  features: string[]
}

async function optionalJson<T>(config: ServerConfig, path: string, init: RequestInit = {}): Promise<T | null> {
  try {
    return await restJson<T>(config, `${BASE}${path}`, init, { timeoutMs: 8000 })
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}

export async function getActivity(
  config: ServerConfig,
  opts: { since?: number; client?: string; limit?: number } = {},
): Promise<ActivitySummary | null> {
  const params = new URLSearchParams()
  if (opts.since !== undefined) params.set('since', String(opts.since))
  if (opts.client) params.set('client', opts.client)
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  const qs = params.toString()

  return optionalJson<ActivitySummary>(config, qs ? `/activity?${qs}` : '/activity')
}

export async function ackBriefing(
  config: ServerConfig,
  opts: { client?: string; at?: number } = {},
): Promise<{ ok: boolean; since: number } | null> {
  return optionalJson<{ ok: boolean; since: number }>(config, '/briefing/ack', {
    method: 'POST',
    body: JSON.stringify({ client: opts.client ?? 'default', ...(opts.at !== undefined ? { at: opts.at } : {}) }),
  })
}

export async function getQuietHours(config: ServerConfig): Promise<QuietHoursConfig | null> {
  return optionalJson<QuietHoursConfig>(config, '/quiet-hours')
}

export async function setQuietHours(
  config: ServerConfig,
  patch: Partial<QuietHoursConfig>,
): Promise<QuietHoursConfig | null> {
  return optionalJson<QuietHoursConfig>(config, '/quiet-hours', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function getFleet(config: ServerConfig): Promise<FleetStatus | null> {
  return optionalJson<FleetStatus>(config, '/fleet')
}

export async function pauseFleet(config: ServerConfig, reason = ''): Promise<FleetStatus | null> {
  return optionalJson<FleetStatus>(config, '/fleet/pause', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function resumeFleet(config: ServerConfig): Promise<FleetStatus | null> {
  return optionalJson<FleetStatus>(config, '/fleet/resume', {
    method: 'POST',
    body: '{}',
  })
}

export async function getTelemetry(config: ServerConfig, days = 7): Promise<TelemetrySummary | null> {
  return optionalJson<TelemetrySummary>(config, `/telemetry?days=${encodeURIComponent(String(days))}`)
}

export async function getApnsStatus(config: ServerConfig): Promise<ApnsStatus | null> {
  return optionalJson<ApnsStatus>(config, '/apns/status')
}

export async function answerMobileApproval(
  config: ServerConfig,
  requestId: string,
  choice: 'once' | 'session' | 'always' | 'deny',
  opts: { profile?: string; kind?: 'auto' | 'kanban' | 'session' } = {},
): Promise<{ answered: boolean; id: string; choice: string; kind?: string } | null> {
  return optionalJson<{ answered: boolean; id: string; choice: string; kind?: string }>(
    config,
    `/approvals/${encodeURIComponent(requestId)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        choice,
        ...(opts.profile ? { profile: opts.profile } : {}),
        ...(opts.kind ? { kind: opts.kind } : {}),
      }),
    },
  )
}
