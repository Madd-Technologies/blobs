import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CronJob } from '../../lib/hermes/cron.ts'
import type { Field, RecordDetail, View } from '../../lib/hermes/dashboard.ts'
import { actionFor, calendarLabel, changeLine, everyWords, figure, fileCard, keptLine, readError, staleNote, MUTE_FOREVER, mutedShort, mutePicks, untilLabel, chartEnds, dashboardRoutines, dateLabel, datePicks, feedsDashboard, formatTyped, groupNumbers, historyLine, isPast, keptBy, longLabel, nextStage, parseDraft, recordDrafts, recordHeading, refreshedSince, safeActionUrl, timeLabel, updatedLine } from './view.ts'

/** Local-time epoch seconds, so the labels read the same in any time zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000
// Tuesday 13 October 2026, 10:00.
const now = at(2026, 10, 13, 10)

const STATUS: Field = { key: 'status', label: 'Status', type: 'status', stages: [{ name: 'New', done: false }, { name: 'Replied', done: false }, { name: 'Done', done: true }] }

describe('values by type', () => {
  it('reads times and dates the way the design does', () => {
    assert.equal(timeLabel(at(2026, 10, 13, 9, 14), now), '9:14 AM')
    assert.equal(timeLabel(at(2026, 10, 12, 20), now), 'Yesterday')
    assert.equal(timeLabel(at(2026, 10, 9, 8), now), 'Fri')
    assert.equal(timeLabel(at(2026, 9, 30, 8), now), 'Sep 30')
    assert.equal(timeLabel(at(2026, 10, 15, 9), now), 'Thu 9:00 AM')
    assert.equal(dateLabel('2026-10-13', now), 'Today')
    assert.equal(dateLabel('2026-10-14', now), 'Tomorrow')
    assert.equal(dateLabel('2026-10-16', now), 'Fri')
    assert.equal(dateLabel('2026-10-31', now), 'Oct 31')
    assert.equal(isPast('2026-10-12', now), true)
    assert.equal(isPast('2026-10-13', now), false)
  })

  it('formats each type', () => {
    assert.equal(formatTyped({ type: 'money', value: 420 }, now), '$420')
    assert.equal(formatTyped({ type: 'money', value: 420.5, currency: 'EUR' }, now), '€420.50')
    assert.equal(formatTyped({ type: 'money', value: 10, currency: 'CHF' }, now), '10 CHF')
    assert.equal(formatTyped({ type: 'percent', value: 76 }, now), '76%')
    assert.equal(formatTyped({ type: 'number', value: 1200 }, now), '1,200')
    assert.equal(formatTyped({ type: 'checkbox', value: true }, now), 'Yes')
    assert.equal(formatTyped({ type: 'rating', value: 4 }, now), '4 of 5')
    assert.equal(formatTyped({ type: 'url', value: 'https://www.example.com/hosting/x' }, now), 'example.com')
    assert.equal(formatTyped({ type: 'link', value: '/home/orion/reports/october.pdf' }, now), 'october.pdf')
    assert.equal(formatTyped({ type: 'text', value: 'Sam Lee' }, now), 'Sam Lee')
  })

  it('knows what tapping a value does', () => {
    assert.deepEqual(actionFor({ type: 'phone', value: '+1 (555) 555-0143' }), { kind: 'tel', url: 'tel:+15555550143', label: 'Call' })
    assert.equal(actionFor({ type: 'email', value: 'a@b.co' })?.url, 'mailto:a@b.co')
    assert.equal(actionFor({ type: 'link', value: '/api/plugins/hermes-drive/files/x/preview' })?.kind, 'viewer')
    assert.equal(actionFor({ type: 'url', value: 'http://insecure' }), null)
    assert.equal(actionFor({ type: 'text', value: 'x' }), null)
  })
})

describe('records', () => {
  it('the next stage is the one white pill, and there is none at the last', () => {
    assert.equal(nextStage(STATUS, 'New'), 'Replied')
    assert.equal(nextStage(STATUS, 'Replied'), 'Done')
    assert.equal(nextStage(STATUS, 'Done'), null)
    assert.equal(nextStage(undefined, 'New'), null)
  })

  it('history in words, with your notes as notes', () => {
    const name = (profile: string) => (profile === 'concierge' ? 'Concierge' : profile)
    const fields = [STATUS, { key: 'reply_by', label: 'Reply by', type: 'date' } as Field]
    assert.equal(historyLine({ at: now, by_kind: 'bot', by: 'concierge', field: '_created', old: null, new: null }, fields, name).text, 'Concierge added this')
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: 'status', old: 'New', new: 'Replied' }, fields, name).text, 'You set status to Replied')
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: '_approved', old: null, new: 'f'.repeat(64) }, fields, name).text, 'You approved exactly this version')
    assert.equal(historyLine({ at: now, by_kind: 'script', by: 'sender', field: '_sent', old: null, new: 'Sent through Proton' }, fields, name).text, 'Sent: Sent through Proton')
    assert.equal(historyLine({ at: now, by_kind: 'bot', by: 'concierge', field: '_refused', old: null, new: null }, fields, name).text, 'Not sent')
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: 'reply_by', old: null, new: '2026-10-14' }, fields, name).text, 'You set reply by to Tomorrow')
    assert.deepEqual(historyLine({ at: now, by_kind: 'person', by: 'you', field: '_note', old: null, new: 'Offer 1 PM' }, fields, name), { who: 'You', text: 'Offer 1 PM', note: true })
  })
})

describe('the record screen', () => {
  const fields: Field[] = [
    { key: 'customer', label: 'Customer', type: 'text', required: true },
    STATUS,
    { key: 'reply_by', label: 'Reply by', type: 'datetime' },
    { key: 'details', label: 'Details', type: 'longtext' },
  ]
  const detail = (patch: Partial<RecordDetail> = {}): RecordDetail => ({
    record: { id: 'r1', collection: 'courier/requests', source_key: 'm1', values: { customer: 'Late delivery, Order 4', status: 'New', reply_by: at(2026, 10, 13, 11), details: 'Sam asks about Friday.' }, person_fields: {}, created_by: 'concierge', created_at: now, updated_at: now, closed_at: null },
    collection: { key: 'courier/requests', owner: 'courier', id: 'requests', title: 'Requests', fields },
    history: [],
    show: { title: 'customer', subtitle: null, meta: 'reply_by', body: 'details', needs_you: true, view: 'inbox' },
    now,
    ...patch,
  })

  it('is headed the way its panel shows it', () => {
    assert.deepEqual(recordHeading(detail()), { title: 'Late delivery, Order 4', meta: 'Reply by 11:00 AM', body: 'Sam asks about Friday.', needsYou: true, shown: ['customer', 'details'] })
    assert.equal(recordHeading(detail({ show: undefined })).title, 'Late delivery, Order 4')
    assert.equal(recordHeading(detail({ show: undefined })).needsYou, false)
  })

  it('shows each filled draft with who it is for, and says in history that it changed', () => {
    const withDraft = detail()
    withDraft.collection.fields = [...fields, { key: 'reply', label: 'Draft reply', type: 'draft', to: 'customer' }, { key: 'later', label: 'Follow-up', type: 'draft' }]
    withDraft.record.values = { ...withDraft.record.values, customer: 'Sam Lee', reply: 'Hi Sam, it works.', later: '' }
    assert.deepEqual(recordDrafts(withDraft).map(draft => [draft.heading, draft.text]), [['Draft reply · to Sam Lee', 'Hi Sam, it works.']])
    const name = (profile: string) => profile
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: 'reply', old: 'Hi', new: 'Hi Sam' }, withDraft.collection.fields, name).text, 'You edited the draft reply')
    assert.equal(historyLine({ at: now, by_kind: 'bot', by: 'concierge', field: 'reply', old: null, new: 'Hi' }, withDraft.collection.fields, name).text, 'concierge wrote a draft reply')
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: '_action', old: null, new: 'Send reply' }, withDraft.collection.fields, name).text, 'You pressed Send reply')
  })

  it('says what a linked document is and where it opens', () => {
    assert.deepEqual(fileCard('link', 'https://docs.google.com/document/d/abc123/edit'), { kind: 'Google Doc', where: 'opens in Docs', opens: 'web' })
    assert.deepEqual(fileCard('url', 'https://docs.google.com/spreadsheets/d/abc/edit#gid=0'), { kind: 'Google Sheet', where: 'opens in Sheets', opens: 'web' })
    assert.equal(fileCard('link', 'https://drive.google.com/file/d/abc/view')?.kind, 'Drive file')
    assert.deepEqual(fileCard('link', '/home/hermes/reports/october.pdf'), { kind: 'october.pdf', where: 'opens here', opens: 'viewer' })
    assert.deepEqual(fileCard('link', '/api/plugins/hermes-paperless/documents/42/preview'), { kind: 'Paperless document', where: 'opens here', opens: 'viewer' })
    assert.deepEqual(fileCard('link', 'https://www.ticketmaster.com/order/123'), { kind: 'ticketmaster.com', where: 'opens in the browser', opens: 'web' })
    assert.equal(fileCard('url', 'https://www.example.com/hosting'), null, 'a web page stays a row')
    assert.equal(fileCard('text', 'https://docs.google.com/document/d/x'), null)
    assert.equal(fileCard('link', ''), null)
  })

  it('offers mute timeframes and reads when a mute lifts', () => {
    // Tuesday 10:00.
    assert.deepEqual(mutePicks(now).map(pick => [pick.label, pick.note]), [
      ['In 1 hour', '11:00 AM'],
      ['This evening', '6:00 PM'],
      ['Tomorrow morning', 'Wed 9:00 AM'],
      ['Next week', 'Mon 9:00 AM'],
      ['Until I unmute', ''],
    ])
    assert.equal(mutePicks(at(2026, 10, 13, 19)).some(pick => pick.label === 'This evening'), false, 'not once the evening has begun')
    assert.equal(mutePicks(now).at(-1)?.until, MUTE_FOREVER)
    assert.equal(untilLabel(at(2026, 10, 19, 9), now), 'Mon 9:00 AM')
    assert.equal(untilLabel(at(2026, 10, 14, 9), now), 'tomorrow 9:00 AM')
    assert.equal(untilLabel(at(2026, 10, 30, 9), now), 'Oct 30, 9:00 AM')
    assert.equal(untilLabel(MUTE_FOREVER, now), 'you unmute')
    assert.equal(mutedShort(at(2026, 10, 19, 9), now), 'Mon')
    assert.equal(mutedShort(at(2026, 10, 13, 18), now), '6:00 PM')
    assert.equal(mutedShort(MUTE_FOREVER, now), '')
    const fields: Field[] = []
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: '_muted', old: null, new: at(2026, 10, 19, 9) }, fields, name => name).text, 'You muted it until Mon 9:00 AM')
    assert.equal(historyLine({ at: now, by_kind: 'person', by: 'you', field: '_muted', old: 1, new: null }, fields, name => name).text, 'You unmuted it')
  })

  it('reads dates in full, as the design does', () => {
    assert.equal(longLabel({ type: 'date', value: '2026-10-16' }, now), 'Fri, Oct 16')
    assert.equal(longLabel({ type: 'date', value: '2026-10-13' }, now), 'Today, Oct 13')
    assert.equal(longLabel({ type: 'date', value: '2026-11-02' }, now), 'Mon, Nov 2')
    assert.equal(longLabel({ type: 'datetime', value: at(2026, 10, 13, 8, 12) }, now), 'Today, 8:12 AM')
    assert.equal(longLabel({ type: 'datetime', value: at(2026, 9, 2, 9) }, now), 'Sep 2, 9:00 AM')
    assert.equal(longLabel({ type: 'text', value: 'Sam' }, now), 'Sam')
    assert.equal(calendarLabel({ type: 'date', value: '2026-10-14' }), 'Wed, Oct 14')
    assert.equal(calendarLabel({ type: 'datetime', value: at(2026, 10, 14, 9) }), 'Oct 14, 9:00 AM')
  })

  it('offers today, tomorrow and next Monday', () => {
    assert.deepEqual(datePicks(now).map(pick => pick.value), ['2026-10-13', '2026-10-14', '2026-10-19'])
    // On a Monday, next week is seven days on.
    assert.equal(datePicks(at(2026, 10, 12, 9))[2]?.value, '2026-10-19')
  })

  it('reads what you typed by type', () => {
    assert.deepEqual(parseDraft({ key: 'amount', label: 'Amount', type: 'money' }, '$1,250.50'), { value: 1250.5 })
    assert.deepEqual(parseDraft({ key: 'n', label: 'Nights', type: 'number' }, 'three'), { error: 'That isn’t a number.' })
    assert.deepEqual(parseDraft({ key: 'customer', label: 'Customer', type: 'text', required: true }, '  '), { error: 'Customer can’t be empty.' })
    assert.deepEqual(parseDraft({ key: 'note', label: 'Note', type: 'text' }, ''), { value: null })
    assert.deepEqual(parseDraft({ key: 'site', label: 'Site', type: 'url' }, 'example.com'), { error: 'Links start with https://' })
  })
})

describe('panels', () => {
  const number = (id: string): View => ({ id, title: id, kind: 'number', collection: 'b/c', value: 1 })
  const list: View = { id: 'l', title: 'L', kind: 'list', collection: 'b/c', rows: [] }

  it('consecutive numbers share a row of up to three', () => {
    const grouped = groupNumbers([number('a'), number('b'), list, number('c'), number('d'), number('e'), number('f')])
    assert.deepEqual(grouped.map(entry => (Array.isArray(entry) ? entry.map(view => view.id) : entry.id)), [['a', 'b'], 'l', ['c', 'd', 'e'], ['f']])
  })

  it('numbers against the last period', () => {
    assert.equal(changeLine(9, 6, 'week'), '3 more')
    assert.equal(changeLine(4, 6, 'week'), '2 fewer')
    assert.equal(changeLine(6, 6, 'week'), 'same as last week')
    assert.equal(changeLine(6, undefined), '')
    assert.equal(changeLine(1240, 1200, 'week', { type: 'money' }), '$40 more')
    assert.equal(changeLine(1200, 1240.5, 'week', { type: 'money', currency: 'EUR' }), '€40.50 less')
    assert.equal(changeLine(91, 96, 'month', { type: 'percent' }), '5% less')
    assert.equal(changeLine(4, 6, 'week', { type: 'rating' }), '2 fewer', 'an average rating is no amount')
  })

  it('a number panel’s figure reads like its cell', () => {
    assert.equal(figure(1240), '1,240')
    assert.equal(figure(3.14159), '3.14')
    assert.equal(figure(null), '–')
    assert.equal(figure(undefined, { type: 'money' }), '–')
    assert.equal(figure(1240, { type: 'money' }), '$1,240')
    assert.equal(figure(89.5, { type: 'money', currency: 'EUR' }), '€89.50')
    assert.equal(figure(1240, { type: 'money', currency: 'CHF' }), '1,240 CHF')
    assert.equal(figure(96, { type: 'percent' }), '96%')
    assert.equal(figure(4.25, { type: 'rating' }), '4.25', 'only money and percent change the figure')
  })

  it('a chart’s ends and the updated line', () => {
    assert.deepEqual(chartEnds([{ start: '2026-08-24' }, { start: '2026-10-12' }], 'week'), ['Aug 24', 'This week'])
    assert.equal(updatedLine([{ ...list, updated: at(2026, 10, 13, 8, 2) }], now), 'Updated 8:02 AM')
    assert.equal(updatedLine([], now), '')
    assert.equal(refreshedSince([{ ...list, updated: now + 5 }], now), true)
  })

  it('says how each panel stays fresh', () => {
    assert.equal(keptLine({ kept: { how: 'live', kind: 'ics', ttl: 60 }, live: { as_of: at(2026, 10, 13, 9, 58) } }, 'Orion', now), 'Updates itself from your calendar · read 9:58 AM')
    assert.equal(
      keptLine({ kept: { how: 'computed', feed: { how: 'script', every: '5m', note: 'Scout writes only when something changes' } }, open: 7 }, 'Scout', now),
      '7 open · a script checks every 5 min; Scout writes only when something changes',
    )
    assert.equal(keptLine({ kept: { how: 'computed', feed: { how: 'model_on_change' } }, open: 2 }, 'Orion', now), '2 open · Orion checks only when something new needs it')
    assert.equal(keptLine({ kept: { how: 'computed', feed: { how: 'model_timer', every: '1h' } } }, 'Orion', now), 'Orion checks every hour')
    assert.equal(keptLine({ kept: { how: 'written' } }, 'Orion', now), 'Written by Orion')
    assert.equal(keptLine({ kept: { how: 'computed' }, open: 3 }, 'Orion', now, 'kept by “Feed watch”, every 15 minutes'), '3 open · kept by “Feed watch”, every 15 minutes')
    assert.equal(everyWords('15m'), '15 min')
    assert.equal(everyWords('2h'), '2 hours')
    assert.equal(staleNote({ live: { as_of: at(2026, 10, 13, 9, 42), error: 'timeout' } }, now), 'Couldn’t read · as of 9:42 AM')
    assert.equal(staleNote({ live: { as_of: null, error: 'no file at data/sensors.db' } }, now), 'Couldn’t read', 'never read: no rows to date')
    assert.equal(staleNote({ live: { as_of: at(2026, 10, 13, 9, 42) } }, now), '')
    assert.equal(staleNote({}, now), '')
  })

  it('a live panel’s menu says why it couldn’t read', () => {
    const script = { how: 'live', kind: 'script', ttl: 60 } as const
    const traceback = 'the script failed: Traceback (most recent call last):\n  File "scripts/disk.py", line 4, in <module>\n    print(json.dumps(rows))\nKeyError: \'used\''

    assert.equal(readError(traceback), 'the script failed: KeyError: \'used\'')
    assert.equal(readError('the url didn’t answer JSON: timed out'), 'the url didn’t answer JSON: timed out')
    assert.equal(readError('Traceback (most recent call last)\nValueError: bad'), 'ValueError: bad', 'no short lead: just the last line')
    assert.equal(keptLine({ kept: script, live: { as_of: at(2026, 10, 13, 9, 42), error: traceback } }, 'Orion', now), 'Updates itself from a script · couldn’t read it since 9:42 AM: the script failed: KeyError: \'used\'')
    assert.equal(keptLine({ kept: script, live: { as_of: null, error: 'no script disk.py in scripts' } }, 'Orion', now), 'Updates itself from a script · couldn’t read it: no script disk.py in scripts')
  })

  it('only safe links open outside the app', () => {
    assert.equal(safeActionUrl('tel:+15555550143'), 'tel:+15555550143')
    assert.equal(safeActionUrl('javascript:alert(1)'), null)
  })
})

describe('routines that keep a dashboard', () => {
  const job = (patch: Partial<CronJob>): CronJob => ({ id: 'j', name: 'J', enabled: true, state: 'scheduled', ...patch })

  it('by the dashboard skill or a prompt that writes records, and only those that are on', () => {
    assert.equal(feedsDashboard(job({ skills: ['hermes-dashboard:dashboard'] })), true)
    assert.equal(feedsDashboard(job({ prompt: 'Upsert each message into requests with dashboard_record.' })), true)
    assert.equal(feedsDashboard(job({ prompt: 'Back up the game server.' })), false)
    assert.deepEqual(dashboardRoutines([job({ id: 'a', skills: ['hermes-dashboard:dashboard'] }), job({ id: 'b', skills: ['hermes-dashboard:dashboard'], enabled: false, state: 'paused' })]).map(entry => entry.id), ['a'])
  })

  it('the panel menu names the routine and how often it runs', () => {
    assert.equal(keptBy([job({ name: 'Feed watch', schedule: { kind: 'interval', minutes: 15 } })]), 'kept by “Feed watch”, every 15 minutes')
    assert.equal(keptBy([job({ name: 'A' }), job({ name: 'B' })]), 'kept by “A” and 1 more')
    assert.equal(keptBy([]), '')
  })
})
