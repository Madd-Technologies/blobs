import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isMainChat, mergeHits, searchSessions, snippetParts, worthShowing, type SessionHit } from './search.ts'
import type { ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'http://x', auth: { kind: 'token', token: 't' } }

const hit = (partial: Partial<SessionHit> = {}): SessionHit => ({ profile: 'orion', sessionId: 's1', lineageRoot: 's1', title: '', source: 'tui', role: 'assistant', snippet: 'a >>>match<<< here', lastActive: 100, messageCount: 4, ...partial })

describe('searchSessions', () => {
  it('asks the server about one bot and reads its rows', async () => {
    const real = globalThis.fetch
    let url = ''

    globalThis.fetch = (async (input: string | URL | Request) => {
      url = String(input)

      return new Response(JSON.stringify({ results: [{ session_id: 's9', lineage_root: 's1', title: 'Trip', source: 'tui', role: 'user', snippet: '>>>hotel<<<', last_active: 50, message_count: 3 }, { snippet: 'no id' }] }), { status: 200 })
    }) as typeof fetch

    try {
      const hits = await searchSessions(config, 'zz bot', ' hotel ', 5)
      assert.equal(url, 'http://x/api/sessions/search?q=hotel&limit=5&profile=zz%20bot')
      assert.deepEqual(hits, [{ profile: 'zz bot', sessionId: 's9', lineageRoot: 's1', title: 'Trip', source: 'tui', role: 'user', snippet: '>>>hotel<<<', lastActive: 50, messageCount: 3 }])
    } finally {
      globalThis.fetch = real
    }
  })

  it('does not ask for nothing', async () => {
    assert.deepEqual(await searchSessions(config, 'orion', '   '), [])
  })
})

describe('snippetParts', () => {
  it('marks the words that matched and squeezes the whitespace', () => {
    assert.deepEqual(snippetParts('...booked the >>>hotel<<<\n  near the   station...'), [
      { text: '...booked the ', hit: false },
      { text: 'hotel', hit: true },
      { text: ' near the station...', hit: false },
    ])
  })

  it('handles several matches, a match at either end, and a snippet with none', () => {
    assert.deepEqual(snippetParts('>>>a<<< b >>>c<<<'), [
      { text: 'a', hit: true },
      { text: ' b ', hit: false },
      { text: 'c', hit: true },
    ])
    assert.deepEqual(snippetParts('  plain text '), [{ text: 'plain text', hit: false }])
    assert.deepEqual(snippetParts(''), [])
  })

  it('reads a match inside stored JSON as the words it holds', () => {
    assert.deepEqual(snippetParts('{\\"content\\": \\"1|The code is >>>4821<<<.\\n\\"}'), [
      { text: '{"content": "1|The code is ', hit: false },
      { text: '4821', hit: true },
      { text: '. "}', hit: false },
    ])
  })

  it('does not show a marker the server left open', () => {
    assert.deepEqual(snippetParts('x >>>half'), [
      { text: 'x ', hit: false },
      { text: 'half', hit: true },
    ])
  })
})

describe('worthShowing', () => {
  it('drops routine runs and chats that matched on what bots say to each other, but not a chat that matched in a tool’s output', () => {
    assert.equal(worthShowing(hit()), true)
    assert.equal(worthShowing(hit({ role: 'tool' })), true)
    assert.equal(worthShowing(hit({ source: 'cron' })), false)
    assert.equal(worthShowing(hit({ snippet: 'Message from 🤖 juniper (@juniper): hi' })), false)
    assert.equal(worthShowing(hit({ snippet: '[IMPORTANT: Background process proc_1 completed' })), false)
    assert.equal(worthShowing(hit({ role: '' })), true)
  })
})

describe('mergeHits', () => {
  it('lists the newest chats first, once each, and not more than asked', () => {
    const merged = mergeHits([[hit({ sessionId: 'a', lastActive: 10 }), hit({ sessionId: 'a', lastActive: 10 })], [hit({ profile: 'juniper', sessionId: 'b', lastActive: 30 }), hit({ sessionId: 'c', source: 'cron', lastActive: 99 })]], 2)
    assert.deepEqual(merged.map(entry => `${entry.profile}:${entry.sessionId}`), ['juniper:b', 'orion:a'])
  })

  it('keeps two bots’ chats that share an id apart', () => {
    assert.equal(mergeHits([[hit()], [hit({ profile: 'juniper' })]]).length, 2)
  })
})

describe('isMainChat', () => {
  it('matches the bot’s main chat by either id, or by the chain it began', () => {
    assert.equal(isMainChat(hit({ sessionId: 'tip' }), { id: 'old', resolved_id: 'tip' }), true)
    assert.equal(isMainChat(hit({ sessionId: 'tip', lineageRoot: 'old' }), { id: 'old', resolved_id: null }), true)
    assert.equal(isMainChat(hit({ sessionId: 'other' }), { id: 'old', resolved_id: 'tip' }), false)
    assert.equal(isMainChat(hit(), null), false)
  })
})
