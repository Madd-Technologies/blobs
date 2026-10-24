import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { coalesce } from './coalesce.ts'

describe('coalescing change signals', () => {
  it('runs once for a burst, and keeps runs at least the gap apart', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })

    try {
      const runs: number[] = []
      const { signal } = coalesce(() => runs.push(Date.now()), { delayMs: 400, minGapMs: 3_000 })

      signal()
      signal()
      signal()
      mock.timers.tick(400)
      assert.equal(runs.length, 1, 'three signals, one run')

      // A signal right after the run waits out the gap instead of running again at once.
      signal()
      mock.timers.tick(400)
      assert.equal(runs.length, 1)
      mock.timers.tick(2_600)
      assert.equal(runs.length, 2)
      assert.ok((runs[1] as number) - (runs[0] as number) >= 3_000)

      // Long after, a single signal is back to the short delay.
      mock.timers.tick(10_000)
      signal()
      mock.timers.tick(400)
      assert.equal(runs.length, 3)
    } finally {
      mock.timers.reset()
    }
  })

  it('cancel drops a pending run', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })

    try {
      let runs = 0
      const { signal, cancel } = coalesce(() => runs++, { delayMs: 400, minGapMs: 3_000 })

      signal()
      cancel()
      mock.timers.tick(5_000)
      assert.equal(runs, 0)
    } finally {
      mock.timers.reset()
    }
  })
})
