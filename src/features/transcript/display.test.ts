import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildDisplay, carriedOnIds, formatStamp, runningLine, turnEnds } from './display.ts'
import type { Item } from './types.ts'

/** Local time, so the tests do not depend on the machine's timezone. */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 10, 8, 18, 0)

const user = (id: string, ts?: number): Item => ({ kind: 'user', id, text: id, ts })
const bot = (id: string, ts?: number): Item => ({ kind: 'assistant', id, text: id, streaming: false, ts })

describe('formatStamp', () => {
  it('words today, yesterday, this week, and older dates', () => {
    assert.equal(formatStamp(at(2026, 10, 8, 9, 38), NOW), 'Today 9:38 AM')
    assert.equal(formatStamp(at(2026, 10, 8, 0, 5), NOW), 'Today 12:05 AM')
    assert.equal(formatStamp(at(2026, 10, 8, 12, 0), NOW), 'Today 12:00 PM')
    assert.equal(formatStamp(at(2026, 10, 7, 16, 12), NOW), 'Yesterday 4:12 PM')
    assert.equal(formatStamp(at(2026, 10, 5, 16, 12), NOW), 'Mon 4:12 PM')
    assert.equal(formatStamp(at(2026, 9, 20, 7, 3), NOW), 'Sep 20, 7:03 AM')
    assert.equal(formatStamp(at(2025, 12, 31, 23, 59), NOW), 'Dec 31, 2025, 11:59 PM')
  })
})

describe('buildDisplay', () => {
  const opts = { now: NOW, showThinking: false }

  describe('pictures a tool made', () => {
    const made = (id: string, image?: string): Item => ({ kind: 'activity', id, steps: [{ toolId: id, name: 'image_generate', context: '', state: 'done', ...(image ? { image } : {}) }] })
    const entries = (list: Item[]) => buildDisplay(list, opts).flatMap(entry => (entry.kind === 'item' ? [entry] : []))

    it('names them on the activity, and tells the reply that follows not to draw them again', () => {
      const [, activity, reply] = entries([user('a', at(2026, 10, 8, 9, 0)), made('t1', '/h/x.png'), bot('b', at(2026, 10, 8, 9, 1))])

      assert.deepEqual(activity?.made, ['/h/x.png'])
      assert.deepEqual(reply?.drawn, ['/h/x.png'])
    })

    it('forgets them when you speak again', () => {
      const out = entries([user('a', at(2026, 10, 8, 9, 0)), made('t1', '/h/x.png'), bot('b', at(2026, 10, 8, 9, 1)), user('c', at(2026, 10, 8, 9, 2)), bot('d', at(2026, 10, 8, 9, 3))])

      assert.equal(out.at(-1)?.drawn, undefined)
    })

    it('adds nothing for an activity that made none', () => {
      const [, activity, reply] = entries([user('a', at(2026, 10, 8, 9, 0)), made('t1'), bot('b', at(2026, 10, 8, 9, 1))])

      assert.equal(activity?.made, undefined)
      assert.equal(reply?.drawn, undefined)
    })
  })

  it('labels the first message and each new stretch, not every message', () => {
    const items = [user('a', at(2026, 10, 8, 9, 0)), bot('b', at(2026, 10, 8, 9, 1)), user('c', at(2026, 10, 8, 9, 20)), user('d', at(2026, 10, 8, 10, 30))]
    const out = buildDisplay(items, opts)
    assert.deepEqual(out.map(entry => (entry.kind === 'date' ? entry.label : (entry.item as { id: string }).id)), ['Today 9:00 AM', 'a', 'b', 'c', 'Today 10:30 AM', 'd'])
  })

  it('starts a new stretch at midnight even when the gap is short', () => {
    const items = [user('a', at(2026, 10, 7, 23, 50)), user('b', at(2026, 10, 8, 0, 5))]
    assert.equal(buildDisplay(items, opts).filter(entry => entry.kind === 'date').length, 2)
  })

  it('items without a time (tools, prompts) never get a label of their own', () => {
    const items: Item[] = [user('a', at(2026, 10, 8, 9, 0)), { kind: 'activity', id: 'act', steps: [] }, { kind: 'error', id: 'e', message: 'x' }, bot('b', at(2026, 10, 8, 9, 2))]
    assert.equal(buildDisplay(items, opts).filter(entry => entry.kind === 'date').length, 1)
  })

  it('hides thinking unless asked', () => {
    const items: Item[] = [user('a', at(2026, 10, 8, 9, 0)), { kind: 'thinking', id: 't', text: 'hmm' }]
    assert.equal(buildDisplay(items, opts).some(entry => entry.kind === 'item' && entry.item.kind === 'thinking'), false)
    assert.equal(buildDisplay(items, { ...opts, showThinking: true }).some(entry => entry.kind === 'item' && entry.item.kind === 'thinking'), true)
  })

  it('works with no timestamps at all', () => {
    assert.deepEqual(buildDisplay([user('a'), bot('b')], opts).map(entry => entry.kind), ['item', 'item'])
  })
})

describe('runningLine', () => {
  it('shows the server status only while thinking', () => {
    assert.equal(runningLine('thinking', 'Hindsight — recalled 94 memories'), 'Hindsight — recalled 94 memories')
    assert.equal(runningLine('thinking', null), 'Thinking…')
  })

  it('says what is happening once text flows or a tool runs, whatever the status text still says', () => {
    assert.equal(runningLine('writing', 'Hindsight — recalled 94 memories'), 'Writing…')
    assert.equal(runningLine('tool', 'Hindsight — recalled 94 memories'), 'Working…')
  })
})

describe('runs the bot carried on after', () => {
  const run = (id: string): Item => ({ kind: 'activity', id, steps: [{ toolId: id, name: 'terminal', context: 'ls /x', state: 'failed', exitCode: 2 }] })
  const failure = (id: string): Item => ({ kind: 'error', id, message: 'Model error' })

  it('a run followed by a reply or more steps in the same turn was handled', () => {
    assert.deepEqual([...carriedOnIds([user('u'), run('r1'), bot('b'), run('r2'), bot('b2')], false)], ['r2', 'r1'])
  })

  it('the last run of a finished turn, with nothing after it, was not', () => {
    assert.deepEqual([...carriedOnIds([user('u'), run('r1'), user('u2'), bot('b')], false)], [])
    assert.deepEqual([...carriedOnIds([user('u'), bot('b'), run('r1')], false)], [])
  })

  it('an error or thinking after it does not count as carrying on', () => {
    assert.deepEqual([...carriedOnIds([user('u'), run('r1'), { kind: 'thinking', id: 't', text: 'hmm' }, failure('e')], false)], [])
  })

  it('while the last turn is still running, its last run is not where things stopped', () => {
    assert.deepEqual([...carriedOnIds([user('u'), run('r1')], true)], ['r1'])
    assert.deepEqual([...carriedOnIds([user('u'), run('r1'), user('u2')], true)], [], 'a finished earlier turn is unaffected')
  })

  it('buildDisplay marks those activities', () => {
    const entries = buildDisplay([user('u'), run('r1'), bot('b'), run('r2')], { now: NOW, showThinking: false }).flatMap(entry => (entry.kind === 'item' ? [entry] : []))

    assert.equal(entries.find(entry => entry.item.id === 'r1')?.carriedOn, true)
    assert.equal(entries.find(entry => entry.item.id === 'r2')?.carriedOn, undefined)
  })
})

describe('which replies get the reply buttons', () => {
  it('the last reply of each finished turn, not what the bot said along the way', () => {
    const items = [user('u1'), bot('looking'), bot('answer'), user('u2'), bot('second')]
    const { ends, last } = turnEnds(items, false)
    assert.deepEqual([...ends].sort(), ['answer', 'second'])
    assert.equal(last, 'second')
  })

  it('none for the turn still running, and Retry then belongs to no turn', () => {
    const { ends, last } = turnEnds([user('u1'), bot('answer'), user('u2'), bot('partial')], true)
    assert.deepEqual([...ends], ['answer'])
    assert.equal(last, null)
  })

  it('skips a reply still streaming, an empty one, and what bots said to each other', () => {
    const streaming: Item = { kind: 'assistant', id: 's', text: 'half', streaming: true }
    const chatter: Item = { kind: 'assistant', id: 'c', text: 'to a bot', streaming: false, chatter: true }
    assert.deepEqual([...turnEnds([user('u1'), bot('done'), streaming], false).ends], ['done'])
    assert.deepEqual([...turnEnds([user('u1'), bot('done'), chatter], false).ends], ['done'])
  })

  it('buildDisplay marks them', () => {
    const entries = buildDisplay([user('u1'), bot('answer')], { now: NOW, showThinking: false }).flatMap(entry => (entry.kind === 'item' ? [entry] : []))
    const reply = entries.find(entry => entry.item.id === 'answer')
    assert.equal(reply?.endsTurn, true)
    assert.equal(reply?.lastTurn, true)
  })
})
