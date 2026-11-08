import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { absentGate } from './absent.ts'

describe('absentGate', () => {
  it('asks every time while the plugin is there or not yet known', () => {
    const gate = absentGate(1000, () => 0)
    assert.equal(gate.due(), true)
    gate.seen(true)
    assert.equal(gate.due(), true)
    assert.equal(gate.missing(), false)
  })

  it('asks a missing plugin again only once the wait is over', () => {
    let t = 0
    const gate = absentGate(1000, () => t)
    gate.seen(false)
    assert.equal(gate.missing(), true)
    t = 999
    assert.equal(gate.due(), false)
    t = 1000
    assert.equal(gate.due(), true)
  })

  it('notices an install: once the plugin answers, every tick asks again', () => {
    let t = 0
    const gate = absentGate(1000, () => t)
    gate.seen(false)
    t = 1000
    gate.seen(true)
    t = 1001
    assert.equal(gate.due(), true)
  })

  it('asks at once after a reset (a reconnect or another server)', () => {
    const gate = absentGate(1000, () => 5)
    gate.seen(false)
    assert.equal(gate.due(), false)
    gate.reset()
    assert.equal(gate.due(), true)
    assert.equal(gate.missing(), false)
  })
})
