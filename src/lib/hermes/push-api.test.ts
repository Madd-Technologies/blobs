import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { addPushDevice, getPushStatus, removePushDevice, sendPushTest, setPushLevels, setPushPresence } from './push-api.ts'
import type { ServerConfig } from './server.ts'

let servers = 0
/** A fresh server address per test: the module remembers which plugin each server answered with. */
const fresh = (): ServerConfig => ({ baseUrl: `https://h${++servers}.ts.net`, auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } })
const STATUS = { devices: [], settings: { default: 'all', bots: {} } }

/** A server with these plugins loaded: their status routes answer, the rest of their routes answer `body`. */
function plugins(loaded: string[], body: unknown = {}) {
  return answer(url => {
    const plugin = /\/api\/plugins\/([^/]+)\//.exec(url)?.[1] ?? ''

    if (!loaded.includes(plugin)) {
      return { status: 404, text: '{"detail":"Not Found"}' }
    }

    return { body: url.endsWith('/status') ? STATUS : body }
  })
}

const realFetch = globalThis.fetch

function answer(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const { status = 200, body, text } = handler(url, init)

    return new Response(text ?? JSON.stringify(body), { status })
  }) as typeof fetch

  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('push status', () => {
  it('reads the plugin state, asking hermes-bot-mobile first', async () => {
    const calls = answer(() => ({ body: STATUS }))
    const status = await getPushStatus(fresh())
    assert.deepEqual(status, STATUS)
    assert.match(calls[0]?.url ?? '', /\/api\/plugins\/hermes-bot-mobile\/status$/)
  })

  it('falls back to hermes-push on a server that has only that', async () => {
    const server = fresh()
    const calls = plugins(['hermes-push'], { removed: 'x' })
    assert.deepEqual(await getPushStatus(server), STATUS)
    await removePushDevice(server, 'x')
    assert.match(calls.at(-1)?.url ?? '', /\/api\/plugins\/hermes-push\/devices\/x$/)
  })

  it('is null when the server has neither plugin', async () => {
    answer(() => ({ status: 404, text: '{"detail":"Plugin not found"}' }))
    assert.equal(await getPushStatus(fresh()), null)
  })

  it('is null when the server answers an unknown path with its web page', async () => {
    answer(() => ({ text: '<!doctype html><html></html>' }))
    assert.equal(await getPushStatus(fresh()), null)
  })

  it('is null when the answer is not the plugin’s shape', async () => {
    answer(() => ({ body: { hello: 'world' } }))
    assert.equal(await getPushStatus(fresh()), null)
  })

  it('still throws for real failures', async () => {
    answer(() => ({ status: 500, text: 'boom' }))
    await assert.rejects(getPushStatus(fresh()), /500/)
  })
})

describe('push calls', () => {
  it('asks which plugin answers before a first call, instead of guessing', async () => {
    const server = fresh()
    const calls = plugins(['hermes-push'], { id: 'abc', name: 'Phone', host: 'ntfy.x', created: 1, last_ok: null, last_error: null })
    await addPushDevice(server, { endpoint: 'https://ntfy.x/up1', p256dh: 'P', auth: 'A', name: 'Phone' })
    const post = calls.find(call => call.init.method === 'POST')
    assert.match(post?.url ?? '', /\/api\/plugins\/hermes-push\/devices$/)
    assert.deepEqual(JSON.parse(post?.init.body as string), { endpoint: 'https://ntfy.x/up1', p256dh: 'P', auth: 'A', name: 'Phone' })
    assert.equal((post?.init.headers as Record<string, string>).Authorization, 'Bearer tok')
  })

  it('moves to hermes-bot-mobile when hermes-push stops answering (the server switched and restarted)', async () => {
    const server = fresh()
    plugins(['hermes-push'])
    await getPushStatus(server)
    const calls = plugins(['hermes-bot-mobile'], { default: 'all', bots: { juniper: 'off' } })
    const settings = await setPushLevels(server, { bots: { juniper: 'off', old: null } })
    assert.deepEqual(settings.bots, { juniper: 'off' })
    const put = calls.filter(call => call.init.method === 'PUT')
    assert.match(put.at(-1)?.url ?? '', /\/api\/plugins\/hermes-bot-mobile\/settings$/)
    assert.deepEqual(JSON.parse(put.at(-1)?.init.body as string), { bots: { juniper: 'off', old: null } })
  })

  it('removes a device by an escaped id', async () => {
    const server = fresh()
    const calls = plugins(['hermes-bot-mobile'], { removed: 'a/b' })
    await removePushDevice(server, 'a/b')
    const removal = calls.find(call => call.init.method === 'DELETE')
    assert.equal(removal?.url, `${server.baseUrl}/api/plugins/hermes-bot-mobile/devices/a%2Fb`)
  })

  it('a 404 the plugin means (an unknown phone) still reaches the caller', async () => {
    const server = fresh()
    answer(url => (url.endsWith('/status') ? { body: STATUS } : { status: 404, text: '{"detail":"Unknown device."}' }))
    await assert.rejects(setPushPresence(server, { device: 'gone', foreground: true, sessions: [] }), /404/)
  })

  it('tests one phone or all', async () => {
    const server = fresh()
    const calls = plugins(['hermes-bot-mobile'], { results: [{ device: 'abc', ok: true, status: 201, error: null, gone: false }] })
    const results = await sendPushTest(server, 'abc')
    assert.equal(results[0]?.ok, true)
    const posts = () => calls.filter(call => call.init.method === 'POST')
    assert.deepEqual(JSON.parse(posts()[0]?.init.body as string), { device: 'abc' })

    await sendPushTest(server)
    assert.deepEqual(JSON.parse(posts()[1]?.init.body as string), {})
  })
})
