import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { BotDashboard, View } from '../../lib/hermes/dashboard.ts'
import { dashboardHeadline } from './headline.ts'

const board = (views: View[]): BotDashboard => ({ profile: 'forge', views, collections: {}, now: 1_000 })
const list = (title: string, open: number, needs = 0): View => ({ id: title, kind: 'list', title, collection: 'c', rows: [], open, needs_you: needs })
const number = (title: string, value: number | null): View => ({ id: title, kind: 'number', title, collection: null, value })

describe('dashboard headline on a Home tile', () => {
  it('leads with what waits on you, naming the panel when only one holds it', () => {
    assert.deepEqual(dashboardHeadline(board([list('Backups', 3, 1), number('Containers up', 9)]), 1, 1_000), { figure: '1', caption: 'Backups', needsYou: true })
    assert.deepEqual(dashboardHeadline(board([list('Emails', 2, 1), list('Reminders', 1, 1)]), 2, 1_000), { figure: '2', caption: 'need you', needsYou: true })
  })

  it('otherwise shows its first figure', () => {
    assert.deepEqual(dashboardHeadline(board([list('Updates', 3), number('Containers up', 9)]), 0, 1_000), { figure: '9', caption: 'Containers up', needsYou: false })
    assert.equal(dashboardHeadline(board([{ id: 'r', kind: 'number', title: 'Revenue', collection: 'c', value: 1240, unit: { type: 'money' } }]), 0, 1_000).figure, '$1,240')
    assert.deepEqual(dashboardHeadline(board([{ id: 's', kind: 'stat', title: 'Today', collection: null, metrics: [{ label: 'Spent', value: '$4.20' }] }]), 0, 1_000).figure, '$4.20')
  })

  it('then how much is open, then when it changed', () => {
    assert.deepEqual(dashboardHeadline(board([number('Empty', null), list('Reminders', 2)]), 0, 1_000), { figure: '2', caption: 'open · Reminders', needsYou: false })
    assert.equal(dashboardHeadline(board([]), 0, 1_000).caption, 'Nothing here yet')
    assert.deepEqual(dashboardHeadline(null, 0, 1_000), { figure: '', caption: '', needsYou: false }, 'not loaded yet')
  })
})
