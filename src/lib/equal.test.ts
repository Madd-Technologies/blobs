import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sameJson } from './equal.ts'

describe('sameJson', () => {
  it('compares primitives including NaN and -0/+0', () => {
    assert.equal(sameJson(1, 1), true)
    assert.equal(sameJson(1, 2), false)
    assert.equal(sameJson('a', 'a'), true)
    assert.equal(sameJson('a', 'b'), false)
    assert.equal(sameJson(true, false), false)
    assert.equal(sameJson(null, null), true)
    assert.equal(sameJson(null, {}), false)
    assert.equal(sameJson(undefined, null), false)
    assert.equal(sameJson(Number.NaN, Number.NaN), true)
    assert.equal(sameJson(-0, +0), false)
  })

  it('compares arrays by length and order', () => {
    const shared = [1, { a: 2 }]
    assert.equal(sameJson(shared, shared), true)
    assert.equal(sameJson([1, 2, 3], [1, 2, 3]), true)
    assert.equal(sameJson([1, 2], [2, 1]), false)
    assert.equal(sameJson([1, 2], [1, 2, 3]), false)
    assert.equal(sameJson([], {}), false)
  })

  it('compares nested plain objects independent of key insertion order', () => {
    const a = { z: [1, { k: 'v', n: null }], a: true }
    const b = { a: true, z: [1, { n: null, k: 'v' }] }
    assert.equal(sameJson(a, b), true)
    assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false)
    assert.equal(sameJson({ a: 1, b: undefined }, { a: 1, c: undefined }), false)
    assert.equal(sameJson({ a: { nested: 1 } }, { a: { nested: 2 } }), false)
  })
})
