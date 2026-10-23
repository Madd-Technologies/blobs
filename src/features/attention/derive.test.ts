import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { ActiveSessionRow, ProfileRow, ProfilesListResult } from '../../lib/hermes/protocol.ts'
import { botLastActive, deriveAttention, matchActiveToBots, strongestStatus } from './derive.ts'

const NOW = 2_000_000

const base = { hasPendingPrompt: false, lastActive: 1_000 }

describe('deriveAttention', () => {
  it('is idle with nothing going on', () => {
    assert.deepEqual(deriveAttention(base, { now: NOW, seenAt: 1_000 }), { state: 'idle', unread: false })
  })

  it('a pending prompt means it needs you, and beats working', () => {
    const attention = deriveAttention({ ...base, hasPendingPrompt: true, activeStatus: 'working' }, { now: NOW })
    assert.deepEqual([attention.state, attention.reason], ['needsYou', 'prompt'])
  })

  it('status waiting (clarify, sudo, secret) also needs you', () => {
    const attention = deriveAttention({ ...base, activeStatus: 'waiting' }, { now: NOW })
    assert.deepEqual([attention.state, attention.reason], ['needsYou', 'waiting'])
  })

  it('working or starting is working', () => {
    assert.equal(deriveAttention({ ...base, activeStatus: 'working' }, { now: NOW }).state, 'working')
    assert.equal(deriveAttention({ ...base, activeStatus: 'starting' }, { now: NOW }).state, 'working')
    assert.equal(deriveAttention({ ...base, activeStatus: 'idle' }, { now: NOW }).state, 'idle')
  })

  it('a turn background work started is not shown as working; yours is, and one not read yet is', () => {
    assert.equal(deriveAttention({ ...base, activeStatus: 'working', turnByYou: false }, { now: NOW }).state, 'idle')
    assert.equal(deriveAttention({ ...base, activeStatus: 'working', turnByYou: true }, { now: NOW }).state, 'working')
    assert.equal(deriveAttention({ ...base, activeStatus: 'working' }, { now: NOW }).state, 'working')
  })

  it('still needs you when background work asks something: only the working is hidden', () => {
    assert.equal(deriveAttention({ ...base, activeStatus: 'waiting', turnByYou: false }, { now: NOW }).state, 'needsYou')
    assert.equal(deriveAttention({ ...base, hasPendingPrompt: true, activeStatus: 'working', turnByYou: false }, { now: NOW }).state, 'needsYou')
  })

  it('unread needs a seeded mark, newer activity, and a closed chat', () => {
    const busy = { ...base, lastActive: 5_000 }
    assert.equal(deriveAttention(busy, { now: NOW, seenAt: 1_000 }).unread, true)
    assert.equal(deriveAttention(busy, { now: NOW, seenAt: 5_000 }).unread, false, 'nothing newer than the mark')
    assert.equal(deriveAttention(busy, { now: NOW }).unread, false, 'first run is seeded silently, not unread')
    assert.equal(deriveAttention(busy, { now: NOW, seenAt: 1_000, isOpen: true }).unread, false, 'the open chat is read')
  })
})

describe('matchActiveToBots', () => {
  const rows = JSON.parse(readFileSync(new URL('../../../docs/protocol-captures/profiles-list.jsonl', import.meta.url), 'utf8').split('\n')[0] as string) as {
    result: ProfilesListResult
  }
  const roster: ProfileRow[] = rows.result.profiles
  const def = roster.find(bot => bot.name === 'default') as ProfileRow
  const active = (patch: Partial<ActiveSessionRow>): ActiveSessionRow => ({ id: 'live1', session_key: 'unrelated', status: 'idle', ...patch })

  it('matches by stored id against the canonical session', () => {
    const map = matchActiveToBots(roster, [active({ session_key: def.canonical_session?.id as string, status: 'working' })])
    assert.deepEqual([...map.keys()], ['default'])
    assert.equal(map.get('default')?.[0]?.status, 'working')
  })

  it('matches by a live id the app already knows belongs to the bot', () => {
    const map = matchActiveToBots(roster, [active({ id: 'abc123' })], { default: ['abc123'] })
    assert.deepEqual([...map.keys()], ['default'])
  })

  it('leaves sessions that belong to no bot unmapped', () => {
    assert.equal(matchActiveToBots(roster, [active({})]).size, 0)
  })

  it('picks the most urgent status among several sessions', () => {
    const list = [active({ status: 'idle' }), active({ status: 'working' }), active({ status: 'waiting' })]
    assert.equal(strongestStatus(list), 'waiting')
    assert.equal(strongestStatus([active({ status: 'idle' }), active({ status: 'working' })]), 'working')
    assert.equal(strongestStatus([]), undefined)
    assert.equal(strongestStatus(undefined), undefined)
  })

  it('reads the latest activity from either session field', () => {
    const row = { ...def, canonical_session: { id: 'x', last_active: 10 }, last_session: { last_active: 20 } } as ProfileRow
    assert.equal(botLastActive(row), 20)
    assert.equal(botLastActive({ ...def, canonical_session: null, last_session: null }), 0)
  })
})
