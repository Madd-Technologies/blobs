import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LOCK_TAP_MS, pressIn, pressOut, talkLabel } from './talk.ts'

describe('the talk button', () => {
  it('holds to talk and sends on letting go', () => {
    const down = pressIn('idle')

    assert.deepEqual(down, { hold: 'holding', action: 'start' })
    assert.deepEqual(pressOut(down.hold, 1800, false), { hold: 'idle', action: 'send' })
  })

  it('a tap keeps talking, and the next tap sends', () => {
    const down = pressIn('idle')
    const tapped = pressOut(down.hold, LOCK_TAP_MS - 1, false)

    assert.deepEqual(tapped, { hold: 'locked', action: null })

    const again = pressIn(tapped.hold)

    assert.deepEqual(again, { hold: 'locked', action: null })
    assert.deepEqual(pressOut(again.hold, 40, true), { hold: 'idle', action: 'send' })
  })

  it('says what a press will do', () => {
    assert.equal(talkLabel('idle', false), 'Hold to talk')
    assert.equal(talkLabel('holding', false), 'Release to send')
    assert.equal(talkLabel('holding', true), 'Connecting…')
    assert.equal(talkLabel('locked', true), 'Tap to send')
  })
})
