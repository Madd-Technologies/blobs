import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PageRow } from '../../lib/hermes/dashboard.ts'
import { dayName, groupRows, moreLabel, pageCaption } from './page.ts'

// Monday 19 October 2026, noon local.
const NOW = new Date(2026, 9, 19, 12).getTime() / 1000
const row = (id: string, group: PageRow['group']): PageRow => ({ id, done: false, needs_you: false, group })

describe('a page of records', () => {
  it('groups rows by day, as they came', () => {
    const groups = groupRows([row('a', '2026-10-19'), row('b', '2026-10-19'), row('c', '2026-10-20'), row('d', '2026-10-21'), row('e', null)], { key: 'arrives', label: 'Arrives', type: 'date' }, NOW)
    assert.deepEqual(groups.map(group => [group.label, group.rows.map(item => item.id).join('')]), [['Today', 'ab'], ['Tomorrow', 'c'], ['Wed', 'd'], ['No date', 'e']])
  })

  it('groups a time by its day, and a stage by its name', () => {
    const at = new Date(2026, 9, 20, 9).getTime() / 1000
    assert.deepEqual(groupRows([row('a', at), row('b', at + 3600)], { key: 'when', label: 'When', type: 'datetime' }, NOW).map(group => group.label), ['Tomorrow'])
    assert.deepEqual(groupRows([row('a', 'Booked'), row('b', 'Checked in')], { key: 'status', label: 'Status', type: 'status' }, NOW).map(group => group.label), ['Booked', 'Checked in'])
    assert.deepEqual(groupRows([row('a', null)], undefined, NOW), [{ key: '', label: '', rows: [row('a', null)] }])
  })

  it('says which days it covers, or the metric it stands for', () => {
    assert.equal(dayName('2026-10-19'), 'Mon Oct 19')
    assert.equal(pageCaption({ start: '2026-10-19', end: '2026-10-25', period: 'week' }), 'Mon Oct 19 to Sun Oct 25')
    assert.equal(pageCaption({ start: '2026-10-19', end: '2026-10-19', period: 'day' }), 'Mon Oct 19')
    assert.equal(pageCaption({ metric: 'Cabin 4' }), 'Cabin 4')
    assert.equal(pageCaption({}), '')
  })

  it('offers the rest', () => {
    assert.equal(moreLabel({ count: 64 }, 50), 'Show 14 more')
    assert.equal(moreLabel({ count: 3 }, 3), '')
  })
})
