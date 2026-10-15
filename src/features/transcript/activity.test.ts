import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { elapsedS, formatDuration, summarizeActivity, usesScreen, waitingOnYou, wording } from './activity.ts'
import type { Step } from './types.ts'

const step = (partial: Partial<Step> = {}): Step => ({ toolId: 't', name: 'terminal', context: 'docker compose pull', state: 'done', ...partial })

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    assert.equal(formatDuration(0.2), '<1s')
    assert.equal(formatDuration(12.4), '12s')
    assert.equal(formatDuration(72), '1m 12s')
    assert.equal(formatDuration(3 * 3600 + 120), '3h 2m')
    assert.equal(formatDuration(Number.NaN), '<1s')
  })
})

describe('wording', () => {
  it('reads like a person narrating the step', () => {
    assert.deepEqual(wording(step()), { present: 'Running docker compose pull', past: 'Ran docker compose pull' })
    assert.equal(wording(step({ name: 'read_file', context: '/a/b/notes.md' })).past, 'Read notes.md')
    assert.equal(wording(step({ name: 'write_file', context: '/a/b/notes.md' })).present, 'Editing notes.md')
    assert.equal(wording(step({ name: 'computer_use', context: '' })).present, 'Using the computer')
    assert.equal(wording(step({ name: 'some_new_tool', context: '' })).present, 'Using some new tool')
  })

  it('shortens very long commands to one line', () => {
    const text = wording(step({ context: `echo ${'x'.repeat(200)}\nsecond line` })).present
    assert.ok(text.length < 80)
    assert.ok(!text.includes('\n'))
    assert.ok(text.endsWith('…'))
  })
})

describe('summarizeActivity', () => {
  it('a running step shows its own line, with elapsed time', () => {
    const summary = summarizeActivity([step({ state: 'done' }), step({ state: 'running', startedAt: 1_000 })], 13_500)
    assert.equal(summary.kind, 'running')
    assert.equal(summary.title, 'Running docker compose pull')
    assert.equal(summary.elapsedS, 12.5)
    assert.equal(summary.stepCount, 2)
  })

  it('a finished run folds to "Ran N steps · duration"', () => {
    const summary = summarizeActivity([step({ durationS: 30 }), step({ durationS: 42 }), step({ durationS: 0 }), step({ durationS: 0 })])
    assert.deepEqual([summary.kind, summary.title], ['done', 'Ran 4 steps · 1m 12s'])
    assert.equal(summarizeActivity([step({ durationS: 3 })]).title, 'Ran 1 step · 3s')
  })

  it('a failed step is called out with its exit code', () => {
    const summary = summarizeActivity([step({ state: 'failed', resultLine: 'rm: nope: No such file or directory', exitCode: 1 })])
    assert.deepEqual([summary.kind, summary.title], ['failed', 'Command failed · exit 1'])
    assert.equal(summarizeActivity([step({ name: 'read_file', context: '/x/a.txt', state: 'failed' })]).title, 'Read a.txt failed')
    assert.equal(summarizeActivity([step({ state: 'failed' })]).title, 'Command failed')
  })

  it('denied steps are not failures', () => {
    const summary = summarizeActivity([step({ state: 'blocked' })])
    assert.deepEqual([summary.kind, summary.title], ['done', 'Ran docker compose pull · denied'])
  })
})

describe('how long a run of steps took', () => {
  const at = (startedAt: number | undefined, durationS: number | undefined): Step => ({ toolId: 't', name: 'x', context: '', state: 'done', ...(startedAt !== undefined ? { startedAt } : {}), ...(durationS !== undefined ? { durationS } : {}) })

  it('counts a batch issued together once: the server waits for the slowest', () => {
    // Five calls issued at the same moment; the memory recall took 1m 6s and the rest finished sooner (or waited their turn).
    const batch = [at(1000, 7), at(1000, 7), at(1000, 8), at(1000, 66), at(1000, 68)]

    assert.equal(elapsedS(batch), 68)
    assert.equal(summarizeActivity(batch).title, 'Ran 5 steps · 1m 8s')
  })

  it('adds batches that follow one another, and counts the gap between them as nothing', () => {
    assert.equal(elapsedS([at(0, 10), at(0, 4), at(60_000, 5)]), 15)
  })

  it('counts overlapping spans that start at different moments as one stretch', () => {
    assert.equal(elapsedS([at(0, 10), at(5_000, 10)]), 15)
  })

  it('adds steps that have no start time, and ignores steps with no duration', () => {
    assert.equal(elapsedS([at(undefined, 3), at(undefined, 4), at(0, undefined)]), 7)
    assert.equal(elapsedS([]), 0)
  })
})

describe('the bot’s screen in a run of steps', () => {
  it('computer use and browser tools work on the screen; a plain web search or a command does not', () => {
    assert.equal(usesScreen({ name: 'computer_use' }), true)
    assert.equal(usesScreen({ name: 'browser_navigate' }), true)
    assert.equal(usesScreen({ name: 'Browser_Click' }), true)
    assert.equal(usesScreen({ name: 'web_search' }), false)
    assert.equal(usesScreen({ name: 'terminal' }), false)
  })

  it('a run that ends on a refused screen action is waiting on you', () => {
    const held = step({ name: 'computer_use', state: 'blocked', humanHasControl: true })

    assert.equal(waitingOnYou([step(), held]), held)
    assert.equal(waitingOnYou([held, step()]), undefined, 'a later step means it carried on')
    assert.equal(waitingOnYou([]), undefined)
  })

  it('and the folded line says so, rather than "denied"', () => {
    const summary = summarizeActivity([step({ name: 'computer_use', state: 'blocked', humanHasControl: true })])

    assert.equal(summary.title, 'Waiting for you to hand back the screen')
  })
})

describe('browser step wording', () => {
  it('shows a step the tool described in words as written, and an address as browsed', () => {
    assert.equal(wording({ name: 'browser_navigate', context: 'Open example.com on the bot screen' }).past, 'Open example.com on the bot screen')
    assert.equal(wording({ name: 'browser_navigate', context: 'https://example.com/a' }).past, 'Browsed https://example.com/a')
    assert.equal(wording({ name: 'web_search', context: 'Hermes screen viewer feature' }).past, 'Browsed Hermes screen viewer feature')
    assert.equal(wording({ name: 'browser_snapshot', context: '' }).past, 'Browsed')
  })
})

describe('when a run reads as failed', () => {
  const ok = step({ state: 'done', durationS: 1 })
  const bad = step({ state: 'failed', exitCode: 2, durationS: 1 })

  it('a run that ended on a failure is red', () => {
    assert.equal(summarizeActivity([ok, bad]).kind, 'failed')
    assert.equal(summarizeActivity([bad]).title, 'Command failed · exit 2')
  })

  it('a run that failed along the way and carried on is not', () => {
    const summary = summarizeActivity([bad, ok, ok])

    assert.equal(summary.kind, 'done')
    assert.equal(summary.title, 'Ran 3 steps · 3s')
  })
  it('nor is one that ended on a failure when the bot carried on after it (a reply, more steps, or still going)', () => {
    const summary = summarizeActivity([ok, bad], Date.now(), true)

    assert.equal(summary.kind, 'done')
    assert.equal(summary.title, 'Ran 2 steps · 2s')
  })
})
