import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { RestartStatus } from '../../lib/hermes/restart.ts'
import { backLine, busyRows, cameBack, defaultChoice, rowView, uptime, workingLine } from './model.ts'

const NOW = 2_000_000
const names: Record<string, string> = { concierge: 'Concierge', forge: 'Forge' }
const nameOf = (profile: string | null) => (profile && names[profile]) || 'A bot'
const clock = (epochS: number) => `at ${epochS}`

const status = (patch: Partial<RestartStatus> = {}): RestartStatus => ({
  supported: true,
  why: null,
  unit: 'hermes-dashboard.service',
  started_at: NOW - 3 * 86_400,
  now: NOW,
  busy: [],
  gateway: { route: true, restart: 'hermes', same_unit: false },
  last: null,
  retry_after: 0,
  ...patch,
})

const row = (input: Partial<Parameters<typeof rowView>[0]>) => rowView({ status: status(), phase: { kind: 'idle' }, waiting: null, now: NOW, nameOf, clock, ...input })

describe('the Settings row', () => {
  it('rests on how long the dashboard has been up and when it last restarted', () => {
    const view = row({ status: status({ last: { id: 'r1', requested_at: NOW - 100, mode: 'now', include_gateway: false, outcome: 'done', restarted_at: NOW - 90 } }) })
    assert.deepEqual(view, { line: 'Dashboard up 3 days · last restarted at 1999910', tone: 'quiet', spinner: false, opens: 'sheet' })
  })

  it('says which plugin loads after a restart, in text color', () => {
    const view = row({ waiting: { title: 'Blobs plugin', version: '0.1.7' } })
    assert.equal(view.line, 'Blobs plugin 0.1.7 loads after a restart')
    assert.equal(view.tone, 'text')
  })

  it('keeps a wait for the chats, with Cancel', () => {
    const view = row({
      status: status({
        busy: [
          { id: 'a', session: 's1', title: 'Bot Chat', profile: 'concierge', status: 'working' },
          { id: 'b', session: 's2', title: 'Scratch', profile: 'forge', status: 'working' },
        ],
        last: { id: 'r2', requested_at: NOW - 60, mode: 'idle', include_gateway: true, outcome: 'waiting', idle_timeout_s: 600, deadline: NOW + 540 },
      }),
    })
    assert.deepEqual([view.line, view.spinner, view.action], ['Waiting for 2 bots to finish · up to 10 min', true, 'cancel'])
  })

  it('turns amber when the wait timed out, until it was seen', () => {
    const timedOut = status({
      busy: [{ id: 'a', session: 's1', title: 'Bot Chat', profile: 'concierge', status: 'working' }],
      last: { id: 'r3', requested_at: NOW - 700, mode: 'idle', include_gateway: true, outcome: 'timed_out', idle_timeout_s: 600, finished_at: NOW - 100 },
    })
    const view = row({ status: timedOut })
    assert.deepEqual([view.line, view.tone], ['Still busy after 10 min · Concierge is working', 'amber'])
    assert.notEqual(row({ status: timedOut, dismissedTimeout: 'r3' }).tone, 'amber')
  })

  it('says a restart under way reconnects by itself', () => {
    assert.equal(row({ phase: { kind: 'restarting', before: NOW - 10, since: NOW, choice: 'both', waited: [] } }).line, 'Restarting… reconnects by itself')
    assert.equal(row({ status: status({ last: { id: 'r4', requested_at: NOW - 5, mode: 'now', include_gateway: true, outcome: 'restarting_gateway' } }) }).spinner, true)
  })

  it('explains, and does not open, when this Hermes cannot restart itself', () => {
    const view = row({ status: status({ supported: false, why: 'This computer does not run systemd.' }) })
    assert.deepEqual([view.line, view.opens], ['This computer does not run systemd.', null])
  })

  it('offers Hermes’s own gateway restart when the server has no restart plugin', () => {
    // Never a prompt to install or update anything: the plugin is optional.
    assert.deepEqual(row({ status: null }), { line: 'The gateway: messaging and routines', tone: 'quiet', spinner: false, opens: 'sheet' })
  })

  it('mentions a restart that failed', () => {
    const view = row({ status: status({ last: { id: 'r5', requested_at: NOW - 300, mode: 'now', include_gateway: false, outcome: 'not_restarted', finished_at: NOW - 200 } }) })
    assert.equal(view.line, 'Last restart failed at 1999800 · see where it runs')
  })
})

describe('the sheet', () => {
  it('chooses Both while a plugin waits to load and the gateway can restart, else the dashboard', () => {
    assert.equal(defaultChoice(status(), { title: 'Blobs plugin', version: '0.1.7' }), 'both')
    assert.equal(defaultChoice(status(), null), 'dashboard')
    assert.equal(defaultChoice(status({ gateway: { route: false, restart: 'cli', same_unit: null } }), { title: 'Blobs plugin', version: null }), 'dashboard')
  })

  it('names what each busy chat is doing', () => {
    const rows = busyRows(
      [
        { id: 'a', session: 's1', title: 'Bot Chat', profile: 'concierge', status: 'working' },
        { id: 'b', session: 's2', title: 'Group: r-1', profile: 'forge', status: 'waiting' },
        { id: 'c', session: 's3', title: 'Immich update', profile: null, status: 'working' },
      ],
      nameOf,
    )
    assert.deepEqual(rows.map(entry => [entry.name, entry.line, entry.waitingOnYou]), [
      ['Concierge', 'In its chat', false],
      ['Forge', 'In a group room', true],
      ['A bot', 'Immich update', false],
    ])
  })

  it('says who is working in a short line', () => {
    assert.equal(workingLine(['Concierge']), 'Concierge is working')
    assert.equal(workingLine(['Concierge', 'Forge']), 'Concierge and Forge are working')
    assert.equal(workingLine(['A', 'B', 'C']), '3 bots are working')
  })
})

describe('coming back', () => {
  it('counts only a newer dashboard process as back', () => {
    assert.equal(cameBack(status({ started_at: NOW }), NOW - 60), true)
    assert.equal(cameBack(status({ started_at: NOW - 60 }), NOW - 60), false)
    assert.equal(cameBack(null, NOW), false)
  })

  it('says when the gateway stayed, after a restart of both', () => {
    const entry = { id: 'r1', requested_at: NOW, mode: 'now' as const, include_gateway: true, outcome: 'done' }
    const stayed = status({ last: { ...entry, detail: 'The gateway did not restart: Refusing to restart the gateway: 3 live session(s) would be interrupted.' } })

    assert.equal(backLine(stayed, 'both', 'at 9:41'), 'Dashboard back · the gateway didn’t restart: Refusing to restart the gateway: 3 live session(s) would be interrupted.')
    assert.equal(backLine(status({ last: entry }), 'both', 'at 9:41'), 'Hermes is back · restarted at 9:41')
    // A dashboard-only restart never mentions the gateway, and other details are not about it.
    assert.equal(backLine(stayed, 'dashboard', 'at 9:41'), 'Hermes is back · restarted at 9:41')
    assert.equal(backLine(status({ last: { ...entry, detail: 'Replaced by a newer request (now).' } }), 'both', 'at 9:41'), 'Hermes is back · restarted at 9:41')
    assert.equal(backLine(null, 'both', 'at 9:41'), 'Hermes is back · restarted at 9:41')
    assert.ok(backLine(status({ last: { ...entry, detail: `The gateway did not restart: ${'x'.repeat(200)}` } }), 'both', '').endsWith('…'))
  })

  it('reads uptime in minutes, hours, then days', () => {
    assert.equal(uptime(NOW - 120, NOW), 'up 2 min')
    assert.equal(uptime(NOW - 5 * 3600, NOW), 'up 5 h')
    assert.equal(uptime(NOW - 86_400, NOW), 'up 1 day')
  })
})
