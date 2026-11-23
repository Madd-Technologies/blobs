import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { RoomView } from '../rooms/view.ts'
import type { BotView } from '../roster/view.ts'
import { buildStationCommands, filterStationCommands } from './commands.ts'

const bot = (profile: string, name: string): BotView => ({
  profile,
  name,
  meta: undefined,
  row: {
    name: profile,
    path: `/bots/${profile}`,
    is_default: false,
    model: 'claude-sonnet',
    provider: 'anthropic',
    description: '',
    display_name: name,
    skill_count: 0,
    last_session: null,
    worker_session: null,
    canonical_session: null,
    ui_meta_revisions: {},
    has_avatar: false,
  },
  attention: { state: 'idle', unread: false },
  preview: 'Ready',
  urgent: false,
  age: '1m',
  lastActive: 100,
  mood: 'idle',
  pinned: false,
  waiting: 0,
})

const room = (id: string, name: string): RoomView => ({
  id,
  name,
  data: {
    room: {
      room_id: id,
      name,
      members: [],
      authority_gateway_id: 'gw',
      authority_epoch: 1,
      revision: 1,
      created_at: 10,
      updated_at: 20,
    },
    events: [],
    cursor: 0,
    status: null,
  },
  preview: 'Room update',
  age: '2m',
  lastActive: 20,
  working: false,
  attention: { actions: [], mention: null, needsYou: false },
  needsYou: false,
})

describe('station command palette', () => {
  it('builds static routes, quick actions, bots (with dashboards when ready), and rooms, then filters by terms', () => {
    const cmds = buildStationCommands({
      views: [bot('juniper', 'Juniper')],
      rooms: [room('r1', 'Ops War Room')],
      fleetPaused: false,
      quietActive: false,
      dashboardsReady: true,
    })

    assert.ok(cmds.some(c => c.kind === 'route' && c.pathname === '/briefing'))
    assert.ok(cmds.some(c => c.kind === 'bot' && c.mode === 'dashboard' && c.profile === 'juniper'))
    assert.ok(cmds.some(c => c.kind === 'room' && c.roomId === 'r1'))
    assert.equal(cmds[0]?.title, 'Pause fleet')

    const resumed = buildStationCommands({
      views: [],
      rooms: [],
      fleetPaused: true,
      quietActive: true,
      dashboardsReady: false,
    })
    assert.equal(resumed[0]?.title, 'Resume fleet')
    assert.equal(resumed[1]?.title, 'Clear 1h silence')

    assert.equal(filterStationCommands(cmds, 'juniper dash').map(c => c.id).join(','), 'bot:juniper:dash')
    assert.equal(filterStationCommands(cmds, 'ops war').map(c => c.id).join(','), 'room:r1')
    assert.equal(filterStationCommands(cmds, '').length, cmds.length)
  })
})
