import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { NeedsYouRecord } from '../../lib/hermes/dashboard.ts'
import type { RoomView } from '../rooms/view.ts'
import { buildDeck, leftLabel, orderDeck, skip, startAt } from './deck.ts'
import type { InboxEntry } from './derive.ts'

const entry = (key: string, profile: string): InboxEntry => ({ key, profile, kind: 'approval', summary: 'Run a command', inline: true })
const record = (id: string): NeedsYouRecord => ({ view: 'v', view_title: 'Inbox', row: { id, done: false, needs_you: true } })
const room = (id: string, needsYou: boolean) => ({ id, needsYou }) as RoomView

describe('Needs-you deck', () => {
  it('puts bots’ prompts first, then dashboard records, then rooms that need you', () => {
    const deck = buildDeck({
      entries: [entry('e1', 'forge')],
      waitingBots: ['concierge'],
      held: { concierge: { records: [record('r1'), record('r2')], now: 500 } },
      rooms: [room('a', false), room('b', true)],
      nowS: 100,
    })

    assert.deepEqual(
      deck.map(card => card.key),
      ['e1', 'board:concierge:r1', 'board:concierge:r2', 'room:b'],
    )
    assert.equal(deck[1]?.kind === 'board' && deck[1].nowS, 500, 'records use the server’s clock')
  })

  it('leaves out bots whose records are not loaded yet', () => {
    assert.equal(buildDeck({ entries: [], waitingBots: ['courier'], held: {}, rooms: [], nowS: 1 }).length, 0)
  })

  it('moves skipped cards to the back, earliest skipped first', () => {
    const deck = buildDeck({ entries: [entry('a', 'x'), entry('b', 'x'), entry('c', 'x')], waitingBots: [], held: {}, rooms: [], nowS: 1 })
    let skipped = skip([], 'a')
    skipped = skip(skipped, 'b')

    assert.deepEqual(orderDeck(deck, skipped).map(card => card.key), ['c', 'a', 'b'])

    skipped = skip(skipped, 'a')
    assert.deepEqual(orderDeck(deck, skipped).map(card => card.key), ['c', 'b', 'a'], 'skipping again sends it to the very back')
  })

  it('forgets skips for cards that are gone', () => {
    const deck = buildDeck({ entries: [entry('b', 'x')], waitingBots: [], held: {}, rooms: [], nowS: 1 })

    assert.deepEqual(orderDeck(deck, ['a']).map(card => card.key), ['b'])
  })

  it('counts what is left', () => {
    assert.equal(leftLabel(3), '3 left')
    assert.equal(leftLabel(0), '')
  })

  it('opens on the card a Home row was showing, the ones before it after the rest', () => {
    const deck = buildDeck({ entries: [entry('a', 'x'), entry('b', 'x'), entry('c', 'x')], waitingBots: [], held: {}, rooms: [], nowS: 1 })

    assert.deepEqual(orderDeck(deck, startAt(deck, 'b')).map(card => card.key), ['b', 'c', 'a'])
    assert.deepEqual(startAt(deck, 'a'), [], 'already first')
    assert.deepEqual(startAt(deck, 'gone'), [], 'answered meanwhile')
    assert.deepEqual(startAt(deck, undefined), [])
  })
})
