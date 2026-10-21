import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { NeedsYouRecord } from '../../lib/hermes/dashboard.ts'
import type { RoomView } from '../rooms/view.ts'
import { buildDeck, leftLabel, orderDeck, startAt, turn } from './deck.ts'
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

  it('turns like a ring: up for the next card, down for the one before', () => {
    const deck = buildDeck({ entries: [entry('a', 'x'), entry('b', 'x'), entry('c', 'x')], waitingBots: [], held: {}, rooms: [], nowS: 1 })
    const keys = (skipped: string[]) => orderDeck(deck, skipped).map(card => card.key)

    let skipped = turn(deck, 'next')
    assert.deepEqual(keys(skipped), ['b', 'c', 'a'])

    skipped = turn(orderDeck(deck, skipped), 'next')
    assert.deepEqual(keys(skipped), ['c', 'a', 'b'])

    skipped = turn(orderDeck(deck, skipped), 'previous')
    assert.deepEqual(keys(skipped), ['b', 'c', 'a'], 'back to the card before')

    assert.deepEqual(keys(turn(deck, 'previous')), ['c', 'a', 'b'], 'the bottom card comes up from the start too')
    assert.deepEqual(keys(turn(deck, 'next', 2)), ['c', 'a', 'b'], 'a card tapped behind the top one comes up')
    assert.deepEqual(keys(turn(deck, 'next', 3)), ['a', 'b', 'c'], 'all the way round')
    assert.deepEqual(turn(deck.slice(0, 1), 'next'), [], 'one card has nowhere to go')
  })

  it('keeps a new card among the cards not yet turned past', () => {
    const deck = buildDeck({ entries: [entry('a', 'x'), entry('b', 'x')], waitingBots: [], held: {}, rooms: [], nowS: 1 })
    const skipped = turn(deck, 'next')
    const grown = buildDeck({ entries: [entry('a', 'x'), entry('b', 'x'), entry('c', 'x')], waitingBots: [], held: {}, rooms: [], nowS: 1 })

    assert.deepEqual(orderDeck(grown, skipped).map(card => card.key), ['b', 'c', 'a'])
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
