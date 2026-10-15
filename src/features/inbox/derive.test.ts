import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ActiveSessionRow, ApprovalRequestPayload, ProfileRow } from '../../lib/hermes/protocol.ts'
import { matchActiveToBots } from '../attention/derive.ts'
import { blankSession, type BotSession } from '../sessions/store.ts'
import { appendUser, initialTranscript, reduceEvent } from '../transcript/reduce.ts'
import { attentionFor, deriveInbox, type InboxEntry } from './derive.ts'

const NOW = 2_000_000

const bot = (name: string, lastActive = 100): ProfileRow =>
  ({ name, canonical_session: { id: `stored-${name}`, last_active: lastActive }, worker_session: null, last_session: null, ui_meta_revisions: {} }) as unknown as ProfileRow

const active = (partial: Partial<ActiveSessionRow>): ActiveSessionRow => ({ id: 'live', session_key: 'x', status: 'idle', ...partial })

const approval = (id: string, extra: Partial<ApprovalRequestPayload> = {}): ApprovalRequestPayload => ({ command: 'rm -r /x', description: 'delete files', request_id: id, ...extra })

function openChat(name: string, liveId: string, prompts: Parameters<typeof reduceEvent>[1][] = []): BotSession {
  let transcript = appendUser(initialTranscript(), 'hi')
  for (const event of prompts) {
    transcript = reduceEvent(transcript, event)
  }
  return { ...blankSession(name), phase: 'ready', liveId, storedId: `stored-${name}`, transcript }
}

const input = (patch: Partial<Parameters<typeof deriveInbox>[0]> = {}): Parameters<typeof deriveInbox>[0] => ({
  roster: [bot('forge', 300), bot('scout', 200), bot('scribe', 100)],
  sessions: {},
  active: [],
  polled: {},
  knownLiveIds: {},
  ...patch,
})

describe('deriveInbox', () => {
  it('is empty when nothing is waiting', () => {
    assert.deepEqual(deriveInbox(input()).entries, [])
  })

  it('lists prompts from chats the app has open, with what is needed to answer them inline', () => {
    const sessions = {
      forge: openChat('forge', 'live-f', [
        { type: 'approval.request', payload: approval('r1', { choices: ['once', 'deny'] }) },
        { type: 'clarify.request', payload: { request_id: 'q1', questions: [{ question: 'A or B?', choices: ['A', 'B'] }] } },
      ]),
    }
    const { entries } = deriveInbox(input({ sessions }))
    assert.deepEqual(entries.map(entry => [entry.kind, entry.requestId, entry.liveId, entry.inline]), [
      ['approval', 'r1', 'live-f', true],
      ['question', 'q1', 'live-f', true],
    ])
    assert.equal(entries[0]?.command, 'rm -r /x')
    assert.deepEqual(entries[0]?.choices, ['once', 'deny'])
    assert.equal(entries[1]?.summary, 'A or B?')
  })

  it('finds approvals on working sessions the app has not opened, building the choices itself', () => {
    const rows = [active({ id: 'live-s', session_key: 'stored-scout', status: 'working' })]
    const { entries } = deriveInbox(input({ active: rows, polled: { 'live-s': [approval('r2', { allow_session: false })] } }))
    assert.equal(entries.length, 1)
    assert.deepEqual([entries[0]?.profile, entries[0]?.kind, entries[0]?.liveId], ['scout', 'approval', 'live-s'])
    assert.deepEqual(entries[0]?.choices, ['once', 'always', 'deny'])
  })

  it('a waiting session with no details becomes a link to the chat, not an inline card', () => {
    const rows = [active({ id: 'live-b', session_key: 'stored-scribe', status: 'waiting' })]
    const { entries } = deriveInbox(input({ active: rows }))
    assert.deepEqual(entries.map(entry => [entry.profile, entry.kind, entry.inline]), [['scribe', 'waiting', false]])
  })

  it('does not double-count an open chat that the server also reports as waiting', () => {
    const rows = [active({ id: 'live-f', session_key: 'stored-forge', status: 'waiting' })]
    const sessions = { forge: openChat('forge', 'live-f', [{ type: 'secret.request', payload: { request_id: 's1', prompt: 'API key', env_var: 'K' } }]) }
    const { entries } = deriveInbox(input({ active: rows, sessions }))
    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.kind, 'secret')
    assert.equal(entries[0]?.summary, 'API key')
  })

  it('orders entries by how recently their bot was active and groups them by bot', () => {
    const sessions = {
      scribe: openChat('scribe', 'a', [{ type: 'sudo.request', payload: { request_id: 'x1' } }]),
      forge: openChat('forge', 'b', [{ type: 'approval.request', payload: approval('x2') }]),
    }
    const { entries, byBot } = deriveInbox(input({ sessions }))
    assert.deepEqual(entries.map(entry => entry.profile), ['forge', 'scribe'])
    assert.deepEqual([...byBot.keys()], ['forge', 'scribe'])
  })

  it('a prompt that has been answered is not listed', () => {
    const sessions = { forge: openChat('forge', 'live-f', [{ type: 'approval.request', payload: approval('r1') }]) }
    sessions.forge.transcript = reduceEvent(sessions.forge.transcript, { type: 'message.complete', payload: { text: '', status: 'interrupted' } })
    assert.deepEqual(deriveInbox(input({ sessions })).entries, [])
  })
})

describe('attentionFor', () => {
  const ctx = { now: NOW }
  const run = (name: string, patch: Partial<Parameters<typeof deriveInbox>[0]> = {}) => {
    const i = input(patch)
    const { byBot } = deriveInbox(i)
    const activeByBot = matchActiveToBots(i.roster, i.active, i.knownLiveIds)
    return attentionFor(i.roster.find(entry => entry.name === name) as ProfileRow, { inbox: byBot as Map<string, InboxEntry[]>, activeByBot }, ctx)
  }

  it('needs you when there is an approval waiting', () => {
    const rows = [active({ id: 'live-s', session_key: 'stored-scout', status: 'working' })]
    assert.equal(run('scout', { active: rows, polled: { 'live-s': [approval('r')] } }).state, 'needsYou')
  })

  it('needs you when the server says waiting, even with no details', () => {
    const rows = [active({ session_key: 'stored-scribe', status: 'waiting' })]
    assert.equal(run('scribe', { active: rows }).state, 'needsYou')
  })

  it('working, then idle', () => {
    assert.equal(run('forge', { active: [active({ session_key: 'stored-forge', status: 'working' })] }).state, 'working')
    assert.equal(run('forge').state, 'idle')
  })
})
