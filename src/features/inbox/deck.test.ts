import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildDeck, cardUrgency, deckSummary, filterDeck, pickPreviewCards, triagePrompt, type DeckCard } from './deck.ts'

const errand = (id: string, profile: string) => ({
  id,
  profile,
  session_id: `sess-${id}`,
  created: 100,
  status: 'running' as const,
  brief: {
    title: `Task ${id}`,
    mode: 'ask' as const,
    goal: `Complete ${id}`,
    opening: '',
    facts: [],
    questions: [],
    record: [],
    accept: '',
    notes: '',
    calls: [],
  },
  flags: [],
  ticked: [],
  decided: null,
  calls: [],
})

const boardCard = (profile: string, id: string): DeckCard => ({
  kind: 'board',
  key: `board:${profile}:${id}`,
  profile,
  nowS: 1000,
  record: {
    view: 'v1',
    view_title: 'Tasks',
    row: { id, title: { key: 'title', type: 'text', value: `Row ${id}` }, done: false, needs_you: true },
  },
})

const entryCard = (profile: string, id: string): DeckCard => ({
  kind: 'entry',
  key: `entry:${profile}:${id}`,
  profile,
  entry: {
    key: `entry:${profile}:${id}`,
    profile,
    kind: 'approval',
    summary: 'Approve command',
    command: 'ls -la',
    inline: true,
  },
})

const roomCard = (id: string): DeckCard => ({
  kind: 'room',
  key: `room:${id}`,
  view: {
    id,
    name: 'Planning Room',
    data: {
      room: {
        room_id: id,
        name: 'Planning Room',
        members: [],
        authority_gateway_id: 'gw-1',
        authority_epoch: 1,
        revision: 1,
        created_at: 900,
        updated_at: 1000,
      },
      events: [],
      cursor: 0,
      status: null,
    },
    preview: 'Waiting for your answer',
    age: 'now',
    lastActive: 1000,
    working: false,
    attention: { actions: [], mention: null, needsYou: true },
    needsYou: true,
  },
})

describe('deck urgency, filtering, summary, and triage prompt', () => {
  it('classifies blocked vs review cards', () => {
    assert.equal(cardUrgency(entryCard('alpha', '1')), 'blocked')
    assert.equal(cardUrgency(roomCard('r1')), 'blocked')
    assert.equal(cardUrgency({ kind: 'phone', key: 'phone:q', profile: 'alpha', need: 'question', errand: errand('e1', 'alpha') }), 'blocked')
    assert.equal(cardUrgency({ kind: 'phone', key: 'phone:req', profile: 'alpha', need: 'request', errand: errand('e2', 'alpha') }), 'blocked')
    assert.equal(cardUrgency({ kind: 'phone', key: 'phone:asked', profile: 'alpha', need: 'asked', errand: errand('e3', 'alpha') }), 'review')
    assert.equal(cardUrgency(boardCard('beta', '1')), 'review')
  })

  it('filters by urgency and profile independently or together', () => {
    const cards: DeckCard[] = [
      entryCard('alpha', '1'),
      boardCard('alpha', '2'),
      boardCard('beta', '3'),
      roomCard('r1'),
    ]

    assert.equal(filterDeck(cards, {}).length, 4)
    assert.deepEqual(filterDeck(cards, { urgency: 'blocked' }).map(c => c.key), ['entry:alpha:1', 'room:r1'])
    assert.deepEqual(filterDeck(cards, { urgency: 'review' }).map(c => c.key), ['board:alpha:2', 'board:beta:3'])
    assert.deepEqual(filterDeck(cards, { profile: 'alpha' }).map(c => c.key), ['entry:alpha:1', 'board:alpha:2'])
    assert.deepEqual(filterDeck(cards, { urgency: 'review', profile: 'alpha' }).map(c => c.key), ['board:alpha:2'])
  })

  it('summarizes counts including pending unloaded dashboard items and sorts bots by blocked then total', () => {
    const cards: DeckCard[] = [
      entryCard('beta', '1'),
      boardCard('alpha', '1'),
      boardCard('alpha', '2'),
      boardCard('alpha', '3'),
      roomCard('r1'),
    ]

    const summary = deckSummary(cards, 10)
    assert.equal(summary.blockedCount, 2)
    assert.equal(summary.reviewCount, 13)
    assert.equal(summary.totalCount, 15)
    assert.deepEqual(summary.byBot.alpha, { total: 3, blocked: 0, review: 3 })
    assert.deepEqual(summary.byBot.beta, { total: 1, blocked: 1, review: 0 })
    assert.deepEqual(summary.bots.map(b => b.profile), ['beta', 'alpha'])
  })

  it('builds a clear triage prompt with or without a panel title', () => {
    const withTitle = triagePrompt('Harper', 14, 'Follow ups')
    assert.match(withTitle, /14 items/)
    assert.match(withTitle, /Follow ups/)
    assert.match(withTitle, /Harper/)

    const single = triagePrompt('Scout', 1)
    assert.match(single, /1 item waiting/)
    assert.match(single, /Scout/)
  })

  it('keeps buildDeck ordering stable across mixed sources', () => {
    const e = entryCard('alpha', '1')
    const b = boardCard('beta', '1')
    const r = roomCard('r1')
    if (e.kind !== 'entry' || b.kind !== 'board' || r.kind !== 'room') throw new Error('unexpected kind')

    const cards = buildDeck({
      entries: [e.entry],
      waitingBots: ['beta'],
      held: { beta: { records: [b.record], now: 2000 } },
      rooms: [r.view],
      nowS: 1000,
    })

    assert.deepEqual(cards.map(c => c.kind), ['entry', 'board', 'room'])
  })

  it('picks diverse preview cards across bots before repeating one bot', () => {
    const cards: DeckCard[] = [
      boardCard('alpha', '1'),
      boardCard('alpha', '2'),
      boardCard('alpha', '3'),
      boardCard('beta', '4'),
      boardCard('gamma', '5'),
    ]

    assert.deepEqual(
      pickPreviewCards(cards, 3).map(c => c.key),
      ['board:alpha:1', 'board:beta:4', 'board:gamma:5'],
    )
    assert.deepEqual(
      pickPreviewCards(cards.slice(0, 4), 3).map(c => c.key),
      ['board:alpha:1', 'board:beta:4', 'board:alpha:2'],
    )
    assert.deepEqual(pickPreviewCards(cards, 0), [])
  })
})
