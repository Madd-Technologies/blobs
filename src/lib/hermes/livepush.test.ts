import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { lastMessageBy, parseDashboardChanged, parseRoomLive, parseRoomsChanged, showLiveTurn, type LiveTurn } from './livepush.ts'

describe('pushed room and dashboard changes', () => {
  it('reads a room member turn as it streams, tolerating what it does not know', () => {
    const live = parseRoomLive({
      room_id: 'r-1',
      at: 12.5,
      members: {
        'm-orion': { turn: 't-1', phase: 'writing', tool: null, text: 'Checking the quote', cut: false, steps: [{ id: 'c1', name: 'web_search', done: true, seconds: 0.8 }, 'junk'], started: 10, updated: 12 },
        'm-bad': 'junk',
      },
    })

    assert.deepEqual(live?.members['m-orion']?.steps, [{ id: 'c1', name: 'web_search', done: true, seconds: 0.8 }])
    assert.equal(live?.members['m-orion']?.text, 'Checking the quote')
    assert.equal(Object.keys(live?.members ?? {}).length, 1)
    assert.equal(parseRoomLive({ members: {} }), null, 'no room id')
  })

  it('reads which rooms moved', () => {
    assert.deepEqual(parseRoomsChanged({ rooms: { 'r-1': { latest_seq: 4, revision: 2, updated_at: 99 }, 'r-2': null } }), { 'r-1': { latest_seq: 4, revision: 2, updated_at: 99 } })
    assert.equal(parseRoomsChanged({}), null)
  })

  it('reads dashboard versions and the summary', () => {
    assert.deepEqual(parseDashboardChanged({ versions: { orion: '4.1.9', bad: 3 }, summary: { orion: { needs_you: 2, views: 3, updated: 50 } } }), {
      versions: { orion: '4.1.9' },
      summary: { orion: { needs_you: 2, views: 3, updated: 50 } },
    })
    assert.deepEqual(parseDashboardChanged({ versions: {} }), { versions: {} })
  })

  it('shows a live turn until the room log has that member’s reply, or it went quiet', () => {
    const turn: LiveTurn = { turn: 't-1', phase: 'writing', tool: null, text: 'Hi', cut: false, steps: [], started: 100, updated: 110 }

    assert.equal(showLiveTurn(turn, undefined, 120), true)
    assert.equal(showLiveTurn(turn, 90, 120), true, 'its last message is from before this turn')
    assert.equal(showLiveTurn(turn, 115, 120), false, 'the finished reply is in the log')
    assert.equal(showLiveTurn(turn, undefined, 110 + 11 * 60), false, 'quiet for over ten minutes')
    assert.equal(showLiveTurn({ ...turn, text: '', phase: 'writing' }, undefined, 120), false, 'nothing to show yet')
    assert.equal(showLiveTurn({ ...turn, text: '', phase: 'tool', tool: 'terminal' }, undefined, 120), true)
  })

  it('knows when each member last posted', () => {
    const actor = (id: string, kind = 'member') => ({ kind, id })

    assert.deepEqual(
      lastMessageBy([
        { kind: 'message.member', actor: actor('m-orion'), created_at: 10 },
        { kind: 'turn.settled', actor: actor('gw', 'gateway'), created_at: 12 },
        { kind: 'message.member', actor: actor('m-orion'), created_at: 15 },
        { kind: 'message.user', actor: actor('you', 'user'), created_at: 16 },
      ]),
      { 'm-orion': 15 },
    )
  })
})
