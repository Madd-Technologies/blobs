import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { HostedRoom, RoomEvent } from '../../lib/hermes/protocol.ts'
import { buildRoomViews, roomMatches, type RoomData } from './view.ts'

const room = (id: string, name: string, updated = 100): HostedRoom => ({
  room_id: id,
  name,
  members: [
    { member_id: 'm-forge', profile: 'forge', handle: 'forge', display_name: 'Forge' },
    { member_id: 'm-hermes', profile: 'default', handle: 'orion', display_name: 'Orion' },
  ],
  authority_gateway_id: 'g',
  authority_epoch: 1,
  revision: 1,
  created_at: 1,
  updated_at: updated,
})

let seq = 0
const said = (memberId: string, text: string, ts: number): RoomEvent => ({ room_id: 'r', seq: ++seq, event_id: `e${seq}`, kind: 'message.member', actor: { kind: 'member', id: memberId }, payload: { member_id: memberId, text }, created_at: ts })
const data = (r: HostedRoom, events: RoomEvent[] = [], status: RoomData['status'] = null): RoomData => ({ room: r, events, cursor: events[events.length - 1]?.seq ?? 0, status })

describe('room rows', () => {
  it('shows the last message, how long ago, and sorts the newest room first', () => {
    const views = buildRoomViews({ a: data(room('a', 'Old', 100), [said('m-forge', 'hello', 200)]), b: data(room('b', 'New', 100), [said('m-hermes', 'hi', 900)]) }, 1000)
    assert.deepEqual(views.map(view => view.name), ['New', 'Old'])
    assert.equal(views[0]?.preview, 'Orion: hi')
    assert.equal(views[0]?.age, '1m')
    assert.equal(views[0]?.lastActive, 900)
  })

  it('says the bots are working while the worker is busy', () => {
    const [view] = buildRoomViews({ a: data(room('a', 'R'), [], { running: true, working: true, blocked: false, counts: { running: 1 }, pending_actions: [] }) }, 1000)
    assert.equal(view?.preview, 'Working…')
    assert.equal(view?.age, 'now')
    assert.equal(view?.working, true)
  })

  it('needs you when a bot asks you, and says what was asked', () => {
    const [view] = buildRoomViews({ a: data(room('a', 'Crew'), [said('m-forge', '@you ok to restart the build server tonight?', 500)]) }, 1000)
    assert.equal(view?.needsYou, true)
    assert.equal(view?.preview, 'Forge: @you ok to restart the build server tonight?')
  })

  it('needs you when the server holds an approval, whatever the last message was', () => {
    const [view] = buildRoomViews(
      { a: data(room('a', 'Crew'), [said('m-forge', 'running it', 500)], { running: true, working: false, blocked: false, counts: {}, pending_actions: [{ kind: 'approval', task_id: 't', member_id: 'm-forge', request_id: 'q', execution_generation: 1 }] }) },
      1000,
    )
    assert.equal(view?.needsYou, true)
    assert.equal(view?.preview, 'Waiting for your answer')
  })

  it('has nothing to say for a new room', () => {
    const [view] = buildRoomViews({ a: data(room('a', 'Fresh', 900)) }, 1000)
    assert.equal(view?.preview, 'No messages yet')
    assert.equal(view?.needsYou, false)
  })
})

describe('searching rooms', () => {
  const view = { name: 'Homelab crew', data: data(room('a', 'Homelab crew')) }

  it('matches the room name or a member', () => {
    assert.equal(roomMatches(view, 'home'), true)
    assert.equal(roomMatches(view, 'FORGE'), true)
    assert.equal(roomMatches(view, 'orion'), true)
    assert.equal(roomMatches(view, 'nobody'), false)
    assert.equal(roomMatches(view, '  '), true)
  })
})
