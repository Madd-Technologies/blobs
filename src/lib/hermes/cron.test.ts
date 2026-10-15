import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  askWhyDraft,
  deleteCronJob,
  describeCron,
  describeSchedule,
  durationLabel,
  failedLine,
  inAbout,
  jobState,
  lastRunFailed,
  listCronJobs,
  listCronRuns,
  pauseCronJob,
  routineLine,
  runOutcome,
  sortJobs,
  triggerCronJob,
  whenLabel,
  type CronJob,
} from './cron.ts'
import type { ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'https://h.ts.net', auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } }
const realFetch = globalThis.fetch

function answer(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; text?: string } | Promise<never>) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const result = await handler(url, init)
    const { status = 200, body, text } = result

    return new Response(text ?? JSON.stringify(body), { status })
  }) as typeof fetch

  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
})

// Local-time dates, so the wording tests do not depend on the machine's time zone.
const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute)
const NOW = at(10, 9, 12, 0)

describe('routine REST calls', () => {
  it('lists a bot’s jobs and drops anything that is not a job', async () => {
    const calls = answer(() => ({ body: [{ id: 'a1', name: 'Backup' }, { nope: true }] }))
    assert.deepEqual(await listCronJobs(config, 'zz-bot'), [{ id: 'a1', name: 'Backup' }])
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/cron/jobs?profile=zz-bot')
  })

  it('lists runs for one job, with a limit', async () => {
    const calls = answer(() => ({ body: { runs: [{ id: 'cron_a1_1' }], limit: 5 } }))
    assert.deepEqual(await listCronRuns(config, 'zz-bot', 'a1', 5), [{ id: 'cron_a1_1' }])
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/cron/jobs/a1/runs?profile=zz-bot&limit=5')
  })

  it('pauses and deletes by id, scoped to the bot', async () => {
    const calls = answer(() => ({ body: { id: 'a1', name: 'Backup', enabled: false } }))
    await pauseCronJob(config, 'zz-bot', 'a1')
    await deleteCronJob(config, 'zz-bot', 'a1')
    assert.deepEqual(
      calls.map(call => [call.init.method, call.url]),
      [
        ['POST', 'https://h.ts.net/api/cron/jobs/a1/pause?profile=zz-bot'],
        ['DELETE', 'https://h.ts.net/api/cron/jobs/a1?profile=zz-bot'],
      ],
    )
  })

  it('escapes a job id that is a name', async () => {
    const calls = answer(() => ({ body: {} }))
    await pauseCronJob(config, 'zz-bot', 'Nightly backup/check')
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/cron/jobs/Nightly%20backup%2Fcheck/pause?profile=zz-bot')
  })
})

describe('Run now', () => {
  it('is started when the server answers', async () => {
    answer(() => ({ body: { id: 'a1' } }))
    assert.equal(await triggerCronJob(config, 'zz-bot', 'a1'), 'started')
  })

  it('is busy when the server says it is already running', async () => {
    answer(() => ({ status: 409, text: '{"detail":"Job is already running"}' }))
    assert.equal(await triggerCronJob(config, 'zz-bot', 'a1'), 'busy')
  })

  it('stops listening after the wait and treats the run as started, since the server holds the request until it ends', async () => {
    globalThis.fetch = ((_url: string, init: RequestInit = {}) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
    assert.equal(await triggerCronJob(config, 'zz-bot', 'a1', 20), 'started')
  })

  it('reports any other failure', async () => {
    answer(() => ({ status: 404, text: '{"detail":"Job not found"}' }))
    await assert.rejects(triggerCronJob(config, 'zz-bot', 'a1'), /404/)
  })
})

describe('job state', () => {
  const job = (patch: Partial<CronJob>): CronJob => ({ id: 'a', name: 'A', ...patch })

  it('tells failed, paused, done and waiting apart', () => {
    assert.equal(jobState(job({ last_status: 'error' })), 'failed')
    assert.equal(jobState(job({ enabled: false })), 'paused')
    assert.equal(jobState(job({ state: 'paused' })), 'paused')
    assert.equal(jobState(job({ state: 'completed' })), 'done')
    assert.equal(jobState(job({ state: 'scheduled', last_status: 'ok' })), 'waiting')
  })

  it('shows a paused job as paused even if its last run failed, but still knows the run failed', () => {
    const paused = job({ enabled: false, state: 'paused', last_status: 'error' })
    assert.equal(jobState(paused), 'paused')
    assert.equal(lastRunFailed(paused), true)
    assert.equal(lastRunFailed(job({ last_status: 'ok' })), false)
  })

  it('puts failed ones first, then running ones, then paused, by name', () => {
    const sorted = sortJobs([job({ id: '1', name: 'Zed', enabled: false }), job({ id: '2', name: 'Beta' }), job({ id: '3', name: 'Alpha', last_status: 'error' }), job({ id: '4', name: 'Alpha2' })])
    assert.deepEqual(sorted.map(entry => entry.id), ['3', '4', '2', '1'])
  })

  it('counts a finished run as done when the server records no outcome for it (Hermes 0.21.6)', () => {
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: 2 }), 'ok')
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: 2, end_reason: null }), 'ok')
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: null }), 'running')
  })

  it('takes the job’s word for its newest run, and an older server’s end reason for any run', () => {
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: 2 }, true), 'failed')
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: 2, end_reason: 'cron_complete' }), 'ok')
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: 2, end_reason: 'cron_incomplete_no_output' }), 'failed')
    // Still going is still going, whatever the job last did.
    assert.equal(runOutcome({ id: 'r', started_at: 1, ended_at: null }, true), 'running')
  })
})

describe('schedule wording', () => {
  it('reads common cron expressions', () => {
    assert.equal(describeCron('0 2 * * *'), 'Every day at 2:00 AM')
    assert.equal(describeCron('30 14 * * *'), 'Every day at 2:30 PM')
    assert.equal(describeCron('0 0 * * *'), 'Every day at 12:00 AM')
    assert.equal(describeCron('0 3 * * 0'), 'Sundays at 3:00 AM')
    assert.equal(describeCron('0 9 * * 1,3,5'), 'Mondays, Wednesdays and Fridays at 9:00 AM')
    assert.equal(describeCron('0 9 * * 1-5'), 'Weekdays at 9:00 AM')
    assert.equal(describeCron('0 10 * * 6,0'), 'Weekends at 10:00 AM')
    assert.equal(describeCron('*/15 * * * *'), 'Every 15 minutes')
    assert.equal(describeCron('0 * * * *'), 'Every hour')
    assert.equal(describeCron('15 * * * *'), 'Every hour at :15')
    assert.equal(describeCron('0 */6 * * *'), 'Every 6 hours')
    assert.equal(describeCron('0 8-22 * * *'), 'Every hour, 8:00 AM to 10:00 PM')
    assert.equal(describeCron('30 9-17 * * *'), 'Every hour at :30, 9:00 AM to 5:00 PM')
    assert.equal(describeCron('0 8 1 * *'), 'Monthly on the 1st at 8:00 AM')
    assert.equal(describeCron('0 8 22 * *'), 'Monthly on the 22nd at 8:00 AM')
    assert.equal(describeCron('0 8 13 * *'), 'Monthly on the 13th at 8:00 AM')
  })

  it('gives up on anything stranger rather than guessing', () => {
    assert.equal(describeCron('0 2 * 6 *'), null)
    assert.equal(describeCron('0 9 * * 1-3'), null)
    assert.equal(describeCron('5-10 2 * * *'), null)
    assert.equal(describeCron('0 25 * * *'), null)
    assert.equal(describeCron('0 22-8 * * *'), null)
    assert.equal(describeCron('0 8-22 1 * *'), null)
    assert.equal(describeCron('not cron'), null)
  })

  it('describes the job by its schedule kind, falling back to the server’s text', () => {
    assert.equal(describeSchedule({ id: 'a', name: 'A', schedule: { kind: 'cron', expr: '0 2 * * *' } }), 'Every day at 2:00 AM')
    assert.equal(describeSchedule({ id: 'a', name: 'A', schedule: { kind: 'interval', minutes: 30 } }), 'Every 30 minutes')
    assert.equal(describeSchedule({ id: 'a', name: 'A', schedule: { kind: 'interval', minutes: 120 } }), 'Every 2 hours')
    assert.equal(describeSchedule({ id: 'a', name: 'A', schedule: { kind: 'interval', minutes: 1440 } }), 'Every day')
    assert.equal(describeSchedule({ id: 'a', name: 'A', schedule: { kind: 'once', run_at: at(10, 12, 15, 0).toISOString() } }, NOW), 'Once, Oct 12, 3:00 PM')
    assert.equal(describeSchedule({ id: 'a', name: 'A', schedule_display: 'every other tuesday' }), 'Every other tuesday')
    assert.equal(describeSchedule({ id: 'a', name: 'A' }), 'No schedule')
  })

  it('adds when it next runs, or that it is paused', () => {
    const next = new Date(NOW.getTime() + 3 * 86_400_000).toISOString()
    const job: CronJob = { id: 'a', name: 'A', schedule: { kind: 'cron', expr: '0 3 * * 0' }, next_run_at: next }
    assert.equal(routineLine(job, NOW), 'Sundays at 3:00 AM · next in 3 days')
    assert.equal(routineLine({ ...job, enabled: false }, NOW), 'Sundays at 3:00 AM · Paused')
    assert.equal(routineLine({ ...job, next_run_at: null }, NOW), 'Sundays at 3:00 AM')
  })
})

describe('time wording', () => {
  it('labels a time by how far back it is', () => {
    assert.equal(whenLabel(at(10, 9, 2, 0), NOW), 'Today, 2:00 AM')
    assert.equal(whenLabel(at(10, 8, 2, 0), NOW), 'Yesterday, 2:00 AM')
    assert.equal(whenLabel(at(10, 6, 14, 5), NOW), 'Oct 6, 2:05 PM')
    assert.equal(whenLabel(at(10, 10, 9, 0), NOW), 'Tomorrow, 9:00 AM')
  })

  it('says how long until, only for the future', () => {
    assert.equal(inAbout(30_000), 'in under a minute')
    assert.equal(inAbout(5 * 60_000), 'in 5 min')
    assert.equal(inAbout(60 * 60_000), 'in 1 hour')
    assert.equal(inAbout(5 * 3_600_000), 'in 5 hours')
    assert.equal(inAbout(3 * 86_400_000), 'in 3 days')
    assert.equal(inAbout(-5), null)
  })

  it('formats how long a run took', () => {
    assert.equal(durationLabel(45), '45s')
    assert.equal(durationLabel(192), '3m 12s')
    assert.equal(durationLabel(185), '3m 05s')
    assert.equal(durationLabel(3900), '1h 05m')
    assert.equal(durationLabel(0), '<1s')
    assert.equal(durationLabel(0.4), '<1s')
    assert.equal(durationLabel(-3), '<1s')
  })

  it('says how long ago the last run failed', () => {
    const base: CronJob = { id: 'a', name: 'A', last_status: 'error' }
    assert.equal(failedLine({ ...base, last_run_at: new Date(NOW.getTime() - 4 * 3_600_000).toISOString() }, NOW), 'Last run failed · 4h ago')
    assert.equal(failedLine({ ...base, last_run_at: new Date(NOW.getTime() - 20 * 60_000).toISOString() }, NOW), 'Last run failed · 20m ago')
    assert.equal(failedLine({ ...base, last_run_at: new Date(NOW.getTime() - 5 * 86_400_000).toISOString() }, NOW), 'Last run failed · 5d ago')
    assert.equal(failedLine(base, NOW), 'Last run failed')
  })
})

describe('Ask why', () => {
  it('writes the question for the chat box with the routine, when it failed and why', () => {
    const job: CronJob = { id: 'a', name: 'Nightly backup check', last_status: 'error', last_error: 'Repo   locked\nby another process', last_run_at: at(10, 9, 2, 0).toISOString() }
    assert.equal(askWhyDraft(job, NOW), 'Why did the routine “Nightly backup check” fail today at 2:00 AM? It said: Repo locked by another process')
  })

  it('still asks when the server gave no reason or time', () => {
    assert.equal(askWhyDraft({ id: 'a', name: 'Backup' }, NOW), 'Why did the routine “Backup” fail?')
  })
})
