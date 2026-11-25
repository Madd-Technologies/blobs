import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Errand } from '../../lib/hermes/phone.ts'
import type { ProfileRow } from '../../lib/hermes/protocol.ts'
import type { RoomView } from '../rooms/view.ts'
import type { BotView } from './view.ts'
import { deriveInFlight } from './inflight.ts'

function botView(profile: string, state: 'idle' | 'working' | 'needsYou', preview = 'Idle'): BotView {
  const row: ProfileRow = {
    name: profile,
    path: `/home/orion/.hermes/profiles/${profile}`,
    is_default: false,
    model: 'claude-sonnet',
    provider: 'anthropic',
    description: '',
    display_name: profile[0]!.toUpperCase() + profile.slice(1),
    skill_count: 0,
    last_session: null,
    worker_session: null,
    canonical_session: { id: `chat-${profile}` },
    ui_meta_revisions: {},
    has_avatar: false,
  }

  return {
    profile,
    name: row.display_name,
    meta: undefined,
    row,
    attention: { state, unread: false },
    preview,
    urgent: false,
    age: state === 'working' ? 'now' : '5m',
    lastActive: 1000,
    mood: state === 'working' ? 'work' : 'idle',
    pinned: false,
    waiting: 0,
  }
}

function runningErrand(id: string, profile: string, created: number, status: Errand['status'] = 'running'): Errand {
  return {
    id,
    profile,
    session_id: `sess-${id}`,
    created,
    status,
    brief: {
      title: `Errand ${id}`,
      mode: 'ask',
      goal: 'Check availability',
      opening: '',
      facts: [],
      questions: [],
      record: [],
      accept: '',
      notes: '',
      calls: [],
    },
    flags: [],
    ticked: [],
    decided: null,
    calls: status === 'running' ? [{ id: 'c1', index: 0, name: 'Clinic', number: '+15550001', status: 'live', answered_by: 'human', started: 100, ended: null, outcome: null, transcript: [], question: null, answers: [], hangup: false, error: '', hold: false }] : [],
  }
}

describe('deriveInFlight', () => {
  it('orders running errands, working bots, active rooms, and idle background helpers without duplicating working bots', () => {
    const working = botView('scout', 'working', 'Reading search results…')
    const helperBot = botView('harper', 'idle', 'Background · Indexing docs')
    const idleBot = botView('quiet', 'idle', 'Nothing new')
    const room: RoomView = {
      id: 'room-1',
      name: 'Design Review',
      data: {
        room: { room_id: 'room-1', name: 'Design Review', members: [], authority_gateway_id: 'gw', authority_epoch: 1, revision: 1, created_at: 100, updated_at: 200 },
        events: [],
        cursor: 0,
        status: { running: true, working: true, blocked: false, counts: {}, pending_actions: [] },
      },
      preview: 'Harper is replying…',
      age: 'now',
      lastActive: 200,
      working: true,
      attention: { actions: [], mention: null, needsYou: false },
      needsYou: false,
    }

    const items = deriveInFlight({
      views: [working, helperBot, idleBot],
      rooms: [room],
      errands: {
        old: runningErrand('old', 'scout', 50, 'done'),
        newer: runningErrand('call-2', 'harper', 300, 'running'),
        older: runningErrand('call-1', 'scout', 100, 'running'),
      },
      sessions: {},
      background: [
        { subagent_id: 'task-1', goal: 'Indexing docs', status: 'running', owner_agent_session_id: 'chat-harper' },
        { subagent_id: 'task-2', goal: 'Also working', status: 'running', owner_agent_session_id: 'chat-scout' },
      ],
    })

    assert.deepEqual(
      items.map(item => item.key),
      ['errand:call-2', 'errand:call-1', 'bot:scout', 'room:room-1', 'bg:harper'],
    )
    assert.equal(items[0]?.subtitle, 'Live · Clinic')
    assert.equal(items[4]?.subtitle, 'Helper · Indexing docs')
  })

  it('returns empty array when everything is idle', () => {
    assert.deepEqual(
      deriveInFlight({
        views: [botView('scout', 'idle')],
        rooms: [],
        errands: {},
        sessions: {},
        background: [],
      }),
      [],
    )
  })
})
