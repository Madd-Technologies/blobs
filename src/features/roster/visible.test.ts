import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { StoredMessage } from '../../lib/hermes/rest.ts'
import { activityStamp, isCurrent, lastVisible, visibleState } from './visible.ts'

let n = 0
const row = (role: string, content: string, timestamp: number): StoredMessage => ({ id: ++n, role, content, timestamp }) as StoredMessage

describe('what a bot’s chat shows you last', () => {
  it('is the last message when nothing happened between bots', () => {
    const rows = [row('user', 'hi', 100), row('assistant', 'Hello **there**', 160)]
    assert.deepEqual(lastVisible(rows, '160:2'), { stamp: '160:2', ts: 160, text: 'Hello **there**' })
  })

  it('skips an exchange between bots at the end of the chat (Juniper’s chat, after Orion messaged it)', () => {
    const rows = [row('user', 'Another', 100), row('assistant', 'Sent. test-note', 110), row('user', 'Message from 🤖 Orion (@hermes): ping', 900), row('assistant', 'Ping received.', 910)]
    assert.deepEqual(lastVisible(rows, '910:4'), { stamp: '910:4', ts: 110, text: 'Sent. test-note' })
  })

  it('says there is nothing to show when a chat holds only bot-to-bot messages', () => {
    assert.deepEqual(lastVisible([row('user', 'Message from 🤖 Orion (@hermes): ping', 900), row('assistant', 'pong', 910)], '910:2'), { stamp: '910:2', ts: 0, text: '' })
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
