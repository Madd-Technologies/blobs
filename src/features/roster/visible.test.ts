import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { activityStamp, isCurrent, keepYours, lastVisible, visibleState, yourLastExchange } from './visible.ts'

let n = 0
const row = (role: string, content: string, timestamp: number): StoredMessage => ({ id: ++n, role, content, timestamp }) as StoredMessage

describe('what a bot’s chat shows you last', () => {
  it('is the last message when nothing happened between bots', () => {
    const rows = [row('user', 'hi', 100), row('assistant', 'Hello **there**', 160)]
    assert.deepEqual(lastVisible(rows, '160:2'), { stamp: '160:2', ts: 160, text: 'Hello **there**', yours: 160 })
  })

  it('skips an exchange between bots at the end of the chat (Juniper’s chat, after Orion messaged it)', () => {
    const rows = [row('user', 'Another', 100), row('assistant', 'Sent. test-note', 110), row('user', 'Message from 🤖 Orion (@hermes): ping', 900), row('assistant', 'Ping received.', 910)]
    assert.deepEqual(lastVisible(rows, '910:4'), { stamp: '910:4', ts: 110, text: 'Sent. test-note', yours: 110 })
  })

  it('says there is nothing to show when a chat holds only bot-to-bot messages', () => {
    assert.deepEqual(lastVisible([row('user', 'Message from 🤖 Orion (@hermes): ping', 900), row('assistant', 'pong', 910)], '910:2'), { stamp: '910:2', ts: 0, text: '', yours: 0 })
  })

  it('judges whether what was read still describes the chat, by its activity time or its message count', () => {
    const seen = { stamp: '500:8', ts: 400, text: 'x' }
    assert.equal(isCurrent(seen, { last_active: 500, message_count: 8 }), true)
    assert.equal(isCurrent(seen, { last_active: 501, message_count: 8 }), false)
    // The time can move before the new messages can be read; the count moving is the other tell.
    assert.equal(isCurrent(seen, { last_active: 500, message_count: 9 }), false)
    assert.equal(isCurrent(undefined, { last_active: 500, message_count: 8 }), false)
    assert.equal(isCurrent({ stamp: '500:8', ts: 0, text: '', failed: true }, { last_active: 500, message_count: 8 }), false)
    assert.equal(isCurrent({ stamp: '0:0', ts: 0, text: '' }, null), true)
    assert.equal(activityStamp({ last_active: 5 }), '5:0')
  })

  it('keeps showing an older read until the new one lands (nothing flickers back to the server’s preview)', () => {
    const older = { stamp: '500:8', ts: 400, text: 'Sent. test-note' }
    assert.deepEqual(visibleState(older, { id: 'a' }), { kind: 'known', visible: older })
  })

  it('shows nothing, not the server’s preview, for a chat that has not been read yet', () => {
    assert.deepEqual(visibleState(undefined, { id: 'a' }), { kind: 'pending' })
    assert.deepEqual(visibleState(undefined, { id: 'a', resolved_id: 'b' }), { kind: 'pending' })
  })

  it('falls back to the server’s preview only when there is nothing to read or the read failed', () => {
    assert.deepEqual(visibleState(undefined, null), { kind: 'server' })
    assert.deepEqual(visibleState(undefined, { id: '' }), { kind: 'server' })
    assert.deepEqual(visibleState({ stamp: '1:1', ts: 0, text: '', failed: true }, { id: 'a' }), { kind: 'server' })
  })
})

describe('when you and a bot last talked', () => {
  const process = (at: number) => ({ id: ++n, role: 'user', content: '[IMPORTANT: Background process proc_1 completed normally (exit code 0). Command: make]', timestamp: at, display_kind: 'process_complete' }) as StoredMessage
  const routine = (at: number) => row('user', '[Cronjob "nightly-check" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.] all clear', at)

  it('is your last message, or the bot’s reply in a turn you started', () => {
    const rows = [row('user', 'Can you check the build?', 100), row('assistant', 'On it.', 105), row('assistant', 'The build is green.', 180)]
    assert.equal(lastVisible(rows, 's').yours, 180)
  })

  it('is not moved by what the bot says after background work wakes it, though that is still its last line', () => {
    const rows = [row('user', 'Can you check the build?', 100), row('assistant', 'The build is green.', 180), process(900), row('assistant', 'The deploy finished too.', 905)]
    const read = lastVisible(rows, 's')
    assert.equal(read.yours, 180)
    assert.equal(read.ts, 905, 'the preview still shows the newest line')
  })

  it('is not moved by a routine’s summary either', () => {
    const rows = [row('user', 'Morning', 100), row('assistant', 'Morning!', 101), routine(700), row('assistant', 'Nightly check: nothing needs you.', 710)]
    assert.equal(lastVisible(rows, 's').yours, 101)
  })

  it('counts again once you write, even right after background work', () => {
    const rows = [process(900), row('assistant', 'The deploy finished.', 905), row('user', 'Thanks, what next?', 950)]
    assert.equal(lastVisible(rows, 's').yours, 950)
  })

  it('keeps what an earlier read knew when the newest messages are all background work', () => {
    const earlier = { stamp: 'a', ts: 180, text: 'The build is green.', yours: 180 }
    const busy = lastVisible([process(900), row('assistant', 'The deploy finished.', 905)], 'b')
    assert.equal(busy.yours, 0)
    assert.equal(keepYours(busy, earlier).yours, 180)
    assert.equal(keepYours(busy, earlier).ts, 905)
    // A read that found your exchange wins over the earlier one.
    assert.equal(keepYours(lastVisible([row('user', 'hi', 990)], 'c'), earlier).yours, 990)
  })

  it('falls back to the last line for an entry kept from before it was recorded', () => {
    assert.equal(yourLastExchange({ stamp: 'a', ts: 400, text: 'x' }), 400)
    assert.equal(yourLastExchange({ stamp: 'a', ts: 400, text: 'x', yours: 120 }), 120)
  })
})
