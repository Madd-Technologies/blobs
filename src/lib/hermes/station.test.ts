import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import type { ServerConfig } from './server.ts'
import {
  ackBriefing,
  answerMobileApproval,
  getActivity,
  getApnsStatus,
  getFleet,
  getQuietHours,
  getTelemetry,
  pauseFleet,
  resumeFleet,
  setQuietHours,
} from './station.ts'

const SERVER: ServerConfig = {
  baseUrl: 'https://hermes.example.test',
  auth: { kind: 'token', token: 'test-token' },
}

describe('station API client', () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it('fetches briefing activity, acks, quiet hours, fleet, telemetry, apns status, and approvals', async () => {
    const calls: { url: string; method: string; body?: string }[] = []

    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? init.body : undefined
      calls.push({ url, method, body })

      if (url.includes('/activity')) {
        return new Response(
          JSON.stringify({
            since: 100,
            now: 200,
            counts: { total: 1, completed: 1, failed: 0, approvals: 0, replies: 1, routines: 0 },
            by_bot: {},
            events: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      if (url.includes('/briefing/ack')) {
        return new Response(JSON.stringify({ ok: true, since: 200 }), { status: 200 })
      }

      if (url.includes('/quiet-hours')) {
        return new Response(
          JSON.stringify({ enabled: true, start: '22:00', end: '07:00', timezone: 'UTC', allow_urgent: true, days: [0], muted_until: null }),
          { status: 200 },
        )
      }

      if (url.includes('/fleet/pause') || url.includes('/fleet/resume') || url.endsWith('/fleet')) {
        return new Response(
          JSON.stringify({ paused: url.includes('/pause'), paused_at: null, reason: '', resumed_at: null, bots: [], now: 200 }),
          { status: 200 },
        )
      }

      if (url.includes('/telemetry')) {
        return new Response(
          JSON.stringify({
            days: 14,
            since: 0,
            now: 200,
            totals: { sessions: 2, messages: 8, input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_usd: 0.02 },
            by_bot: {},
            by_model: {},
            daily: [],
          }),
          { status: 200 },
        )
      }

      if (url.includes('/apns/status')) {
        return new Response(JSON.stringify({ configured: true, features: ['apns'] }), { status: 200 })
      }

      return new Response(JSON.stringify({ answered: true, id: 'req-1', choice: 'once', kind: 'session' }), { status: 200 })
    })

    const activity = await getActivity(SERVER, { since: 100, limit: 25 })
    assert.equal(activity?.counts.total, 1)

    const ack = await ackBriefing(SERVER, { client: 'ios-1', at: 200 })
    assert.equal(ack?.ok, true)

    assert.equal((await getQuietHours(SERVER))?.start, '22:00')
    assert.equal((await setQuietHours(SERVER, { enabled: true }))?.enabled, true)

    assert.equal((await getFleet(SERVER))?.paused, false)
    assert.equal((await pauseFleet(SERVER, 'break'))?.paused, true)
    assert.equal((await resumeFleet(SERVER))?.paused, false)

    assert.equal((await getTelemetry(SERVER, 14))?.days, 14)
    assert.equal((await getApnsStatus(SERVER))?.configured, true)

    const approval = await answerMobileApproval(SERVER, 'req-1', 'once', { profile: 'juniper', kind: 'session' })
    assert.equal(approval?.answered, true)

    assert.equal(calls.length, 10)
    assert.ok(calls[0]!.url.endsWith('/api/plugins/hermes-bot-mobile/activity?since=100&limit=25'))
  })

  it('returns null gracefully when server plugin route returns 404', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('Not found', { status: 404 }))
    assert.equal(await getFleet(SERVER), null)
    assert.equal(await getActivity(SERVER), null)
  })
})
