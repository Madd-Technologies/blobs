import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CallSnapshot } from './engine.ts'
import { callStatus, captionTail } from './view.ts'

const live: CallSnapshot = { phase: 'live', speaking: null, caption: null, tasks: 0, muted: false, note: null }

describe('callStatus', () => {
  it('says where the call is', () => {
    assert.deepEqual(callStatus({ ...live, phase: 'connecting' }, 'Orion', false), { text: 'Calling Orion…', mark: 'spinner' })
    assert.deepEqual(callStatus(live, 'Orion', false), { text: 'Listening', mark: null })
    assert.deepEqual(callStatus({ ...live, speaking: 'voice' }, 'Orion', false), { text: 'Speaking', mark: null })
    assert.deepEqual(callStatus({ ...live, muted: true }, 'Orion', false), { text: 'Muted', mark: null })
    assert.deepEqual(callStatus({ ...live, tasks: 1, speaking: 'voice' }, 'Orion', false), { text: 'Orion is on it', mark: 'spinner' })
    assert.deepEqual(callStatus({ ...live, tasks: 2 }, 'Orion', false), { text: 'Orion is on 2 things', mark: 'spinner' })
  })

  it('puts a card that waits for you first, and says why a call ended', () => {
    assert.deepEqual(callStatus({ ...live, tasks: 1 }, 'Orion', true), { text: 'Waiting for you', mark: 'needs' })
    assert.deepEqual(callStatus({ ...live, phase: 'ended', note: 'The call dropped.' }, 'Orion', true), { text: 'The call dropped.', mark: null })
    assert.deepEqual(callStatus({ ...live, phase: 'ended' }, 'Orion', false), { text: 'Call ended', mark: null })
  })
})

describe('captionTail', () => {
  it('keeps a short caption as it is', () => {
    assert.equal(captionTail('  What’s on my calendar\n tomorrow? '), 'What’s on my calendar tomorrow?')
  })

  it('keeps the newest words of a long one, cut at a word', () => {
    const tail = captionTail('one two three four five six seven eight nine ten', 20)

    assert.equal(tail, '…seven eight nine ten')
    assert.ok(tail.length <= 21)
  })
})
