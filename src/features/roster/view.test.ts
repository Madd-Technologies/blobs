import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Attention } from '../attention/derive.ts'
import type { InboxEntry } from '../inbox/derive.ts'
import { blankSession } from '../sessions/store.ts'
import type { BotMeta } from '../../lib/hermes/identity.ts'
import type { ProfileRow } from '../../lib/hermes/protocol.ts'
import { buildBotViews, entryPreview, needsYouNames } from './view.ts'

const NOW = 10_000

function bot(name: string, lastActive: number, extra: Partial<ProfileRow> = {}, meta?: BotMeta): ProfileRow {
  return {
    name,
    path: '~',
    is_default: name === 'default',
    model: 'm',
    provider: 'p',
    description: '',
    display_name: '',
    skill_count: 0,
    last_session: null,
    worker_session: null,
    canonical_session: { id: name, last_active: lastActive, preview: `last words of ${name}` },
    ui_meta: meta ? { 'hermes-bots': meta } : undefined,
    ui_meta_revisions: {},
    has_avatar: false,
    ...extra,
  }
}

const idle: Attention = { state: 'idle', unread: false }
const entry = (patch: Partial<InboxEntry>): InboxEntry => ({ key: 'k', profile: 'forge', kind: 'approval', summary: 'desc', inline: true, ...patch })

describe('what Home shows for a bot another bot has been talking to', () => {
  const juniper = bot('juniper', NOW - 60, { canonical_session: { id: 'h', last_active: NOW - 60, message_count: 10, preview: 'Orion (@hermes): Juniper says the build passed' } })

  it('shows its last real message and when that was, not the server’s preview', () => {
    const [view] = buildBotViews({ roster: [juniper], attention: {}, inbox: new Map(), sessions: {}, now: NOW, visible: { juniper: { stamp: `${NOW - 60}:10`, ts: NOW - 6 * 3600, text: 'Sent. **test-note**' } } })
    assert.deepEqual([view?.preview, view?.age], ['Sent. test-note', '6h'])
  })

  it('keeps showing the last read while a newer one is on its way, instead of the server’s preview', () => {
    const [view] = buildBotViews({ roster: [juniper], attention: {}, inbox: new Map(), sessions: {}, now: NOW, visible: { juniper: { stamp: '1:1', ts: NOW - 6 * 3600, text: 'Sent. test-note' } } })
    assert.deepEqual([view?.preview, view?.age], ['Sent. test-note', '6h'])
  })

  it('shows nothing until the first read, rather than the server’s preview', () => {
    const [view] = buildBotViews({ roster: [juniper], attention: {}, inbox: new Map(), sessions: {}, now: NOW, visible: {} })
    assert.deepEqual([view?.preview, view?.age], ['', ''])
  })

  it('uses the server’s preview only when the read failed or there is no stored chat', () => {
    const failed = buildBotViews({ roster: [juniper], attention: {}, inbox: new Map(), sessions: {}, now: NOW, visible: { juniper: { stamp: '1:1', ts: 0, text: '', failed: true } } })[0]
    // The one case where the server's own words are used: there is nothing else to show.
    assert.equal(failed?.preview, 'Orion (@hermes): Juniper says the build passed')
    const fresh = buildBotViews({ roster: [bot('new', 0, { canonical_session: null })], attention: {}, inbox: new Map(), sessions: {}, now: NOW, visible: {} })[0]
    assert.equal(fresh?.preview, '')
  })

  it('says nothing worth showing for a chat that holds only bot-to-bot messages', () => {
    const [view] = buildBotViews({ roster: [juniper], attention: {}, inbox: new Map(), sessions: {}, now: NOW, visible: { juniper: { stamp: `${NOW - 60}:10`, ts: 0, text: '' } } })
    assert.deepEqual([view?.preview, view?.age], ['', ''])
  })
})

describe('buildBotViews', () => {
  it('orders like the roster and names bots like Desktop', () => {
    const views = buildBotViews({ roster: [bot('default', 100), bot('forge', 300, {}, { title: 'Forge' })], attention: {}, inbox: new Map(), sessions: {}, now: NOW })
    assert.deepEqual(views.map(view => [view.profile, view.name]), [['forge', 'Forge'], ['default', 'Hermes']])
  })

  it('an idle bot shows its last words, in normal weight, with its age', () => {
    const [view] = buildBotViews({ roster: [bot('forge', NOW - 180)], attention: {}, inbox: new Map(), sessions: {}, now: NOW })
    assert.deepEqual([view?.preview, view?.urgent, view?.age, view?.mood], ['last words of forge', false, '3m', 'idle'])
    assert.equal(view?.lastActive, NOW - 180, 'the time its age shows, which Home sorts by')
  })

  it('unread makes the preview stronger, not amber', () => {
    const [view] = buildBotViews({ roster: [bot('forge', 5)], attention: { forge: { state: 'idle', unread: true } }, inbox: new Map(), sessions: {}, now: NOW })
    assert.equal(view?.urgent, true)
  })

  it('a bot that needs you says what it needs, strongly', () => {
    const inbox = new Map([['forge', [entry({ command: 'docker compose up -d' })]]])
    const [view] = buildBotViews({ roster: [bot('forge', 5)], attention: { forge: { state: 'needsYou', unread: false, reason: 'prompt' } }, inbox, sessions: {}, now: NOW })
    assert.deepEqual([view?.preview, view?.urgent, view?.waiting], ['Wants to run docker compose up -d', true, 1])
  })

  it('needing you with no details still says so', () => {
    const [view] = buildBotViews({ roster: [bot('forge', 5)], attention: { forge: { state: 'needsYou', unread: false } }, inbox: new Map(), sessions: {}, now: NOW })
    assert.equal(view?.preview, 'Waiting for your answer')
  })

  it('a working bot shows its live status line, "now", and the working face', () => {
    const session = { ...blankSession('forge'), transcript: { ...blankSession('forge').transcript, statusLine: 'Reading a review' } }
    const [view] = buildBotViews({ roster: [bot('forge', 5)], attention: { forge: { state: 'working', unread: false } }, inbox: new Map(), sessions: { forge: session }, now: NOW })
    assert.deepEqual([view?.preview, view?.age, view?.mood], ['Reading a review', 'now', 'work'])
    const [plain] = buildBotViews({ roster: [bot('forge', 5)], attention: { forge: { state: 'working', unread: false } }, inbox: new Map(), sessions: {}, now: NOW })
    assert.equal(plain?.preview, 'Working…')
  })

  it('a message from another bot names the sender', () => {
    const row = bot('forge', 5, { canonical_session: { id: 'f', last_active: 5, preview: "Message from 🤖 scout (@scout): found it" } })
    const [view] = buildBotViews({ roster: [row], attention: { forge: idle }, inbox: new Map(), sessions: {}, now: NOW })
    assert.equal(view?.preview, 'scout: found it')
  })

  it('flags pinned bots and hides hidden ones', () => {
    const rows = [bot('a', 1, {}, { pinned: true }), bot('b', 2, {}, { hidden: true }), bot('c', 3)]
    const views = buildBotViews({ roster: rows, attention: {}, inbox: new Map(), sessions: {}, now: NOW })
    assert.deepEqual(views.map(view => [view.profile, view.pinned]), [['a', true], ['c', false]])
  })
})

describe('entryPreview', () => {
  it('words each kind of prompt', () => {
    assert.equal(entryPreview(entry({ command: 'rm -r /x' })), 'Wants to run rm -r /x')
    assert.equal(entryPreview(entry({ command: undefined, summary: 'delete files' })), 'delete files')
    assert.equal(entryPreview(entry({ kind: 'sudo' })), 'Needs your sudo password')
    assert.equal(entryPreview(entry({ kind: 'waiting' })), 'Waiting for your answer')
    assert.equal(entryPreview(entry({ kind: 'question', summary: 'A or B?' })), 'A or B?')
  })

  it('keeps a long command to one line', () => {
    const text = entryPreview(entry({ command: `echo ${'x'.repeat(200)}\nmore` }))
    assert.ok(text.length < 100 && !text.includes('\n') && text.endsWith('…'))
  })
})

describe('needsYouNames', () => {
  const view = (name: string, state: Attention['state']) => ({ name, attention: { state, unread: false } }) as Parameters<typeof needsYouNames>[0][number]

  it('lists who needs you and collapses the rest', () => {
    assert.equal(needsYouNames([view('Forge', 'needsYou'), view('Scribe', 'idle'), view('Courier', 'needsYou')]), 'Forge, Courier')
    assert.equal(needsYouNames([view('A', 'needsYou'), view('B', 'needsYou'), view('C', 'needsYou'), view('D', 'needsYou')]), 'A, B, C +1')
    assert.equal(needsYouNames([view('A', 'idle')]), '')
  })
})
