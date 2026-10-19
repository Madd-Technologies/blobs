import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Item, Step } from '../transcript/types.ts'
import { callWork } from './work.ts'

const since = 1_000_000

function step(toolId: string, change: Partial<Step> = {}): Step {
  return { toolId, name: 'read_file', context: '/home/orion/notes.md', state: 'done', durationS: 2, ...change }
}

describe('callWork', () => {
  it('is empty before the call hands anything over', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u-1', text: 'Earlier', ts: since - 60_000 },
      { kind: 'activity', id: 'a-1', steps: [step('t1')] },
    ]

    assert.equal(callWork(items, since, false), null)
    assert.equal(callWork(items, null, false), null)
  })

  it('shows the newest steps of the turn the call started while it runs', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u-1', text: 'Check my calendar', ts: since + 5_000 },
      { kind: 'activity', id: 'a-1', steps: [step('t1'), step('t2', { name: 'terminal', context: 'ls', durationS: 1 })] },
      { kind: 'activity', id: 'a-2', steps: [step('t3', { state: 'running', durationS: undefined, startedAt: since + 9_000 })] },
    ]

    assert.deepEqual(callWork(items, since, true), {
      kind: 'running',
      lines: [
        { id: 't2', state: 'done', text: 'Ran ls', durationS: 1 },
        { id: 't3', state: 'running', text: 'Reading notes.md', startedAt: since + 9_000 },
      ],
    })
  })

  it('folds a finished turn into its summary line', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u-1', text: 'Check my calendar', ts: since + 5_000 },
      { kind: 'activity', id: 'a-1', steps: [step('t1', { startedAt: since + 6_000 }), step('t2', { startedAt: since + 8_000, durationS: 3 })] },
      { kind: 'assistant', id: 'm-1', text: 'You are free until 11.', streaming: false },
    ]
    const work = callWork(items, since, false)

    assert.equal(work?.kind, 'done')
    assert.match(work?.kind === 'done' ? work.summary : '', /^Ran 2 steps · /)
  })

  it('follows the newest task when the call hands over another', () => {
    const items: Item[] = [
      { kind: 'user', id: 'u-1', text: 'First', ts: since + 5_000 },
      { kind: 'activity', id: 'a-1', steps: [step('t1')] },
      { kind: 'assistant', id: 'm-1', text: 'Done.', streaming: false },
      { kind: 'user', id: 'u-2', text: 'Second', ts: since + 30_000 },
    ]

    // The new turn has no steps yet.
    assert.equal(callWork(items, since, true), null)
  })
})
