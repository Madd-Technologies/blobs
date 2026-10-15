import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MOTIONS, motionFor, nextBlink } from './motion.ts'

describe('face motion', () => {
  it('moves by what the bot is doing: needing you comes first, then working, else the resting motion', () => {
    assert.equal(motionFor({ needsYou: true, working: true }), 'needs')
    assert.equal(motionFor({ working: true }), 'work')
    assert.equal(motionFor({}), 'idle')
    assert.equal(motionFor({}, 'still'), 'still', 'lists keep resting faces still')
  })

  it('blinks after a gap within the bounds', () => {
    assert.equal(nextBlink(MOTIONS.idle, () => 0), 3500)
    assert.equal(nextBlink(MOTIONS.idle, () => 1), 6500)
    assert.equal(nextBlink({ ...MOTIONS.idle, blink: null }), null)
  })
})
