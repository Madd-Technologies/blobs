import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DOZE_AFTER_S, MOTIONS, isDozing, motionFor, nextBlink } from './motion.ts'

describe('face motion', () => {
  it('moves by what the bot is doing: needing you comes first, then working, else the resting motion', () => {
    assert.equal(motionFor({ needsYou: true, working: true }), 'needs')
    assert.equal(motionFor({ working: true }), 'work')
    assert.equal(motionFor({}), 'idle')
    assert.equal(motionFor({}, 'still'), 'still', 'lists keep resting faces still')
  })

  it('dozes only at rest: a dozing bot that needs you or works is awake', () => {
    assert.equal(motionFor({ dozing: true }), 'doze')
    assert.equal(motionFor({ dozing: true }, 'still'), 'doze', 'lists show the shut eyes too')
    assert.equal(motionFor({ dozing: true, working: true }), 'work')
    assert.equal(motionFor({ dozing: true, needsYou: true }), 'needs')
  })

  it('dozes after a long quiet spell, never when it has no activity yet', () => {
    const now = 2_000_000_000
    assert.equal(isDozing(now - DOZE_AFTER_S, now), true)
    assert.equal(isDozing(now - DOZE_AFTER_S + 60, now), false)
    assert.equal(isDozing(0, now), false)
    assert.equal(isDozing(undefined, now), false)
  })

  it('a dozing face is still with its eyes shut', () => {
    assert.deepEqual([MOTIONS.doze.blink, MOTIONS.doze.glance, MOTIONS.doze.bob, MOTIONS.doze.hop], [null, null, null, null])
    assert.ok(MOTIONS.doze.eyes < 0.2)
  })

  it('blinks after a gap within the bounds', () => {
    assert.equal(nextBlink(MOTIONS.idle, () => 0), 3500)
    assert.equal(nextBlink(MOTIONS.idle, () => 1), 6500)
    assert.equal(nextBlink({ ...MOTIONS.idle, blink: null }), null)
  })
})
