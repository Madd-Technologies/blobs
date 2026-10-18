import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildChatEntries, isInboxTitle } from './chats.ts'
import type { ChatSummary } from './store.ts'

const chat = (id: string, startedAt: number, extra: Partial<ChatSummary> = {}): ChatSummary => ({ id, title: '', preview: '', startedAt, messageCount: 4, source: 'tui', ...extra })
const main = { id: 'bot-chat', preview: 'Last thing said\nsecond line' }

describe('chat list', () => {
  it('lists the main chat first, then the others newest first', () => {
    const entries = buildChatEntries({ listed: [chat('old', 10, { title: 'Old' }), chat('new', 30, { title: 'New' }), chat('mid', 20, { title: 'Mid' })], main, openId: 'bot-chat', elsewhere: false })
    assert.deepEqual(
      entries.map(entry => entry.id),
      ['bot-chat', 'new', 'mid', 'old'],
    )
    assert.equal(entries[0]?.title, 'Main chat')
    assert.equal(entries[0]?.preview, 'Last thing said')
    assert.equal(entries[0]?.main, true)
  })

  it('names a chat a dashboard button started by the button and the record', () => {
    const entries = buildChatEntries({ listed: [chat('job', 40, { preview: '[Dashboard button "Send reply" · Late delivery, Order 4]\nYour person pressed…' })], main, openId: 'bot-chat', elsewhere: false })
    assert.equal(entries[1]?.title, 'Send reply · Late delivery, Order 4')
  })

  it('marks the open chat: the main one by default', () => {
    const entries = buildChatEntries({ listed: [chat('a', 1, { title: 'A' })], main, openId: 'bot-chat', elsewhere: false })
    assert.deepEqual(
      entries.map(entry => entry.current),
      [true, false],
    )
  })

  it('marks another chat as open when the bot is showing it', () => {
    const entries = buildChatEntries({ listed: [chat('a', 1, { title: 'A' }), chat('b', 2, { title: 'B' })], main, openId: 'a', elsewhere: true })
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.current]),
      [
        ['bot-chat', false],
        ['b', false],
        ['a', true],
      ],
    )
  })

  it('leaves out routines, and the main chat if the server lists it too', () => {
    const entries = buildChatEntries({
      listed: [chat('cron-run', 50, { source: 'cron', title: 'Nightly' }), chat('bot-chat', 40, { title: 'Bot Chat' }), chat('keep', 5, { title: 'Keep' })],
      main: { id: 'tip', resolvedId: 'bot-chat' },
      openId: 'tip',
      elsewhere: false,
    })
    assert.deepEqual(
      entries.map(entry => entry.id),
      ['tip', 'keep'],
    )
  })

  it('names an untitled chat after what was said, or "Untitled chat"', () => {
    const entries = buildChatEntries({ listed: [chat('a', 2, { preview: 'Can you check the build?\nmore' }), chat('b', 1)], main, openId: 'bot-chat', elsewhere: false })
    assert.equal(entries[1]?.title, 'Can you check the build?')
    assert.equal(entries[1]?.preview, '')
    assert.equal(entries[2]?.title, 'Untitled chat')
  })

  it('strips markdown marks from a preview', () => {
    const entries = buildChatEntries({ listed: [], main: { id: 'm', preview: 'This session is `20260101_120000` (**TUI**)' }, openId: 'm', elsewhere: false })
    assert.equal(entries[0]?.preview, 'This session is 20260101_120000 (TUI)')
  })

  it('shows what was said under a chat that has a title', () => {
    const entries = buildChatEntries({ listed: [chat('a', 2, { title: 'Deploy', preview: 'Deploying now\nok' })], main, openId: 'bot-chat', elsewhere: false })
    assert.equal(entries[1]?.preview, 'Deploying now')
  })

  it('lists a brand new chat the server has no row for yet', () => {
    const entries = buildChatEntries({ listed: [chat('a', 2, { title: 'A' })], main, openId: 'fresh', elsewhere: true })
    assert.deepEqual(
      entries.map(entry => [entry.id, entry.title, entry.current]),
      [
        ['bot-chat', 'Main chat', false],
        ['fresh', 'New side chat', true],
        ['a', 'A', false],
      ],
    )
  })

  it('still lists a main chat the roster does not know yet', () => {
    const entries = buildChatEntries({ listed: [], main: { id: null }, openId: null, elsewhere: false })
    assert.deepEqual(entries.map(entry => [entry.id, entry.main, entry.current]), [['main', true, true]])
  })

  describe('the inbox', () => {
    const inbox = chat('inbox-tip', 60, { title: 'Bot Inbox', preview: 'Scout asked for the build log\nmore' })

    it('lists it as Between bots right under the main chat, never open and never main', () => {
      const entries = buildChatEntries({ listed: [chat('a', 70, { title: 'A' })], main, inbox, openId: 'bot-chat', elsewhere: false })
      assert.deepEqual(
        entries.map(entry => [entry.id, entry.title, entry.main, entry.inbox, entry.current]),
        [
          ['bot-chat', 'Main chat', true, false, true],
          ['inbox-tip', 'Between bots', false, true, false],
          ['a', 'A', false, false, false],
        ],
      )
      assert.equal(entries[1]?.preview, 'Scout asked for the build log')
    })

    it('never lists it, or a continuation of it, as a side chat', () => {
      const entries = buildChatEntries({
        listed: [chat('inbox-root', 5, { title: 'Bot Inbox' }), chat('inbox-tip', 60, { title: 'Bot Inbox #2' }), chat('keep', 1, { title: 'Keep' })],
        main,
        inbox: null,
        openId: 'bot-chat',
        elsewhere: false,
      })
      assert.deepEqual(
        entries.map(entry => entry.id),
        ['bot-chat', 'keep'],
      )
    })

    it('puts a brand new side chat after it', () => {
      const entries = buildChatEntries({ listed: [], main, inbox, openId: 'fresh', elsewhere: true })
      assert.deepEqual(
        entries.map(entry => [entry.id, entry.current]),
        [
          ['bot-chat', false],
          ['inbox-tip', false],
          ['fresh', true],
        ],
      )
    })

    it('knows its title, and only its title', () => {
      assert.ok(isInboxTitle('Bot Inbox'))
      assert.ok(isInboxTitle(' Bot Inbox #12 '))
      assert.ok(!isInboxTitle('Bot Inbox notes'))
      assert.ok(!isInboxTitle('Bot Inbox #'))
      assert.ok(!isInboxTitle('Bot Chat'))
      assert.ok(!isInboxTitle(''))
    })
  })
})
