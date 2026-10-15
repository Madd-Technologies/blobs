import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createLimiter, createWants, evictions, replaceRows, shownHeight } from './pictureCache.ts'

describe('evictions', () => {
  it('drops nothing while everything fits', () => {
    assert.deepEqual(evictions({ a: { size: 10, used: 1 }, b: { size: 10, used: 2 } }, 100), [])
  })

  it('drops the least recently used first, and only as many as it takes', () => {
    const entries = { a: { size: 40, used: 3 }, b: { size: 40, used: 1 }, c: { size: 40, used: 2 } }

    assert.deepEqual(evictions(entries, 90), ['b'])
    assert.deepEqual(evictions(entries, 50), ['b', 'c'])
  })

  it('never drops the picture being shown, even when it alone is too big', () => {
    assert.deepEqual(evictions({ a: { size: 500, used: 1 }, b: { size: 10, used: 2 } }, 100, 'a'), ['b'])
    assert.deepEqual(evictions({ a: { size: 500, used: 1 } }, 100, 'a'), [])
  })
})

describe('createLimiter', () => {
  it('runs at most the allowed number at once, and the rest in the order asked', async () => {
    const limit = createLimiter(2)
    let running = 0
    let peak = 0
    const order: number[] = []

    const job = (id: number) =>
      limit(async () => {
        running++
        peak = Math.max(peak, running)
        order.push(id)
        await new Promise<void>(resolve => setTimeout(resolve, 5))
        running--

        return id
      })

    const results = await Promise.all([1, 2, 3, 4, 5].map(job))

    assert.deepEqual(results, [1, 2, 3, 4, 5])
    assert.equal(peak, 2)
    assert.deepEqual(order, [1, 2, 3, 4, 5])
  })

  it('keeps going after a task fails', async () => {
    const limit = createLimiter(1)

    await assert.rejects(limit(async () => Promise.reject(new Error('boom'))), /boom/)
    assert.equal(await limit(async () => 'fine'), 'fine')
  })
})

describe('shownHeight', () => {
  it('follows the picture’s shape between a sliver and a screenful', () => {
    assert.equal(shownHeight(240, 1), 240)
    assert.equal(shownHeight(240, 2), 120)
    assert.equal(shownHeight(240, 0.25), 360)
    assert.equal(shownHeight(240, 100), 48)
  })

  it('shows 4:3 until the size is known, or when it is nonsense', () => {
    assert.equal(shownHeight(240, undefined), 180)
    assert.equal(shownHeight(240, 0), 180)
    assert.equal(shownHeight(240, Number.NaN), 180)
  })
})

describe('createWants', () => {
  it('wants a picture while anything asks for it, and counts the askers', () => {
    const wants = createWants()

    assert.equal(wants.isWanted('a'), false)
    wants.want('a')
    wants.want('a')
    assert.equal(wants.isWanted('a'), true)
    wants.release('a')
    assert.equal(wants.isWanted('a'), true)
    wants.release('a')
    assert.equal(wants.isWanted('a'), false)
  })

  it('does not go negative when a picture is let go more often than it was asked for', () => {
    const wants = createWants()

    wants.release('a')
    wants.want('a')
    assert.equal(wants.isWanted('a'), true)
  })
})

describe('replaceRows', () => {
  it('replaces one list’s rows and leaves another list’s alone', () => {
    const before = { 'chat:a|r1': true as const, 'chat:a|r2': true as const, 'chat:b|r1': true as const }
    const after = replaceRows(before, 'chat:a', ['r2', 'r3'])

    assert.deepEqual(Object.keys(after).sort(), ['chat:a|r2', 'chat:a|r3', 'chat:b|r1'])
  })

  it('clears a list with no rows, and does not take a list whose name starts the same for it', () => {
    assert.deepEqual(replaceRows({ 'chat:a|r1': true, 'chat:ab|r1': true }, 'chat:a', []), { 'chat:ab|r1': true })
  })
})
