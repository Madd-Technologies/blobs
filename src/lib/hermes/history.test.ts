import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fetchWholeRows, hasOlder, LIGHT_TURNS, listLightMessages } from './history.ts'
import type { MessagesPage } from './rest.ts'
import type { ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'https://h.ts.net', auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } }
const realFetch = globalThis.fetch

function answer(handler: (url: string) => { status?: number; body?: unknown }) {
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(url)
    const { status = 200, body } = handler(url)

    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch

  return urls
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const page = (pagination: Partial<MessagesPage['pagination']>): MessagesPage => ({ session_id: 's', messages: [], pagination: { limit: 0, offset: 0, order: 'latest', returned: 0, ...pagination } })

describe('a chat read light', () => {
  it('asks the plugin for the newest turns, from the rows already held', async () => {
    const urls = answer(() => ({ body: page({ returned: 3, has_older: true, turns: LIGHT_TURNS }) }))
    const read = await listLightMessages(config, '20261101_090000_a1b2c3', 'orion', { order: 'latest', limit: 200, offset: 42, includeCompacted: true })

    assert.equal(urls.length, 1)
    assert.match(urls[0] as string, /\/api\/plugins\/hermes-bot-mobile\/history\/20261101_090000_a1b2c3\?bot=orion&turns=20&offset=42$/)
    assert.equal(read.pagination.has_older, true)
  })

  it('falls back to Hermes’s own route where the plugin has no such route', async () => {
    const urls = answer(url => (url.includes('/api/plugins/') ? { status: 404, body: { detail: 'Not Found' } } : { body: page({ returned: 200 }) }))
    const read = await listLightMessages(config, 'chat1', 'orion', { order: 'latest', limit: 200, offset: 0, includeCompacted: true })

    assert.equal(urls.length, 2)
    assert.match(urls[1] as string, /\/api\/sessions\/chat1\/messages\?profile=orion&order=latest&limit=200&offset=0&include_compacted=true$/)
    assert.equal(read.pagination.returned, 200)
  })

  it('does not fall back on other failures', async () => {
    answer(() => ({ status: 500, body: { detail: 'boom' } }))

    await assert.rejects(listLightMessages(config, 'chat1', 'orion'))
  })

  it('asks for whole rows by id, each once', async () => {
    const urls = answer(() => ({ body: { messages: [{ id: 7, role: 'tool', content: 'all of it' }] } }))
    const rows = await fetchWholeRows(config, 'chat1', 'orion', [7, '9', 7])

    assert.match(urls[0] as string, /\/history\/chat1\/rows\?bot=orion&ids=7,9$/)
    assert.deepEqual(rows, [{ id: 7, role: 'tool', content: 'all of it' }])
    assert.deepEqual(await fetchWholeRows(config, 'chat1', 'orion', []), [])
  })

  it('knows there is more from the plugin, or from a full page of Hermes’s own', () => {
    assert.equal(hasOlder(page({ returned: 12, has_older: true }), 200), true, 'twenty turns can be few rows')
    assert.equal(hasOlder(page({ returned: 900, has_older: false }), 200), false)
    assert.equal(hasOlder(page({ returned: 200 }), 200), true)
    assert.equal(hasOlder(page({ returned: 37 }), 200), false)
  })
})
