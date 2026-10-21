import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import type { ServerConfig } from './server.ts'
import { accountHint, botParamFor, getBotVoice, setBotVoice, voiceLine, VoiceRefusal, type BotVoice } from './voice.ts'

const config: ServerConfig = { baseUrl: 'https://h.ts.net', auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } }
const realFetch = globalThis.fetch

const ready: BotVoice = { enabled: true, voice: 'eve', account: 'sign-in', available: { sign_in: true, key: false }, ready: true, model: 'grok-voice-latest' }

function answer(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const { status = 200, body, text } = handler(url, init)

    return new Response(text ?? JSON.stringify(body), { status })
  }) as typeof fetch

  return calls
}

const refusal = (reason: string, message: string) => ({ detail: { reason, message } })

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('getBotVoice', () => {
  it('reads a bot’s settings by profile from a plugin older than 0.1.2', async () => {
    const calls = answer(url => (url.endsWith('/status') ? { body: { version: '0.1.1', provider: 'xai', model: 'm' } } : { body: ready }))

    assert.deepEqual(await getBotVoice(config, 'harbor'), ready)
    assert.equal(calls.at(-1)?.url, 'https://h.ts.net/api/plugins/hermes-voice/bot?profile=harbor')
  })

  it('names the bot `bot` for 0.1.2 and later, which Hermes 0.22 allows', async () => {
    const newer: ServerConfig = { ...config, baseUrl: 'https://newer.ts.net' }
    const calls = answer(url => (url.endsWith('/status') ? { body: { version: '0.1.2', provider: 'xai', model: 'm' } } : { body: ready }))

    assert.deepEqual(await getBotVoice(newer, 'harbor'), ready)
    await getBotVoice(newer, 'juniper')
    assert.deepEqual(calls.map(call => call.url.replace('https://newer.ts.net/api/plugins/hermes-voice', '')), ['/status', '/bot?bot=harbor', '/bot?bot=juniper'])
    assert.equal(botParamFor('0.1.10'), 'bot')
    assert.equal(botParamFor('0.1.1'), 'profile')
    assert.equal(botParamFor(null), 'profile')
  })

  it('is null when the server has no hermes-voice', async () => {
    answer(() => ({ status: 404, body: { detail: 'Not Found' } }))

    assert.equal(await getBotVoice(config, 'harbor'), null)
  })

  it('passes on the plugin’s own refusal, even a 404 for a bot it does not know', async () => {
    answer(() => ({ status: 404, body: refusal('unknown_bot', 'No bot called juniper on this server.') }))

    await assert.rejects(getBotVoice(config, 'juniper'), (error: unknown) => error instanceof VoiceRefusal && error.reason === 'unknown_bot' && error.message === 'No bot called juniper on this server.')
  })

  it('is null for an answer that is not settings', async () => {
    answer(() => ({ body: { hello: 'world' } }))

    assert.equal(await getBotVoice(config, 'harbor'), null)
  })
})

describe('setBotVoice', () => {
  it('sends only what changed and answers the settings as they are now', async () => {
    const calls = answer(() => ({ body: { ...ready, voice: 'rex' } }))

    assert.equal((await setBotVoice(config, 'harbor', { voice: 'rex' })).voice, 'rex')
    assert.equal(calls[0]?.init.method, 'PUT')
    assert.equal(calls[0]?.init.body, JSON.stringify({ voice: 'rex' }))
  })

  it('turns the plugin’s refusal into a VoiceRefusal with its message', async () => {
    answer(() => ({ status: 400, body: refusal('invalid', 'voice cannot be set to \'morgan\'.') }))

    await assert.rejects(setBotVoice(config, 'harbor', { voice: 'eve' }), (error: unknown) => error instanceof VoiceRefusal && error.reason === 'invalid' && error.status === 400)
  })
})

describe('voiceLine', () => {
  it('names the voice when a call can start, and says what is wrong otherwise', () => {
    assert.equal(voiceLine(ready), 'Eve')
    assert.equal(voiceLine({ ...ready, enabled: false }), 'Off')
    assert.equal(voiceLine({ ...ready, ready: false }), 'Not set up')
  })
})

describe('accountHint', () => {
  it('says what each account costs, or what is missing', () => {
    assert.match(accountHint('sign-in', ready), /Grok plan/)
    assert.match(accountHint('key', ready), /no XAI_API_KEY/)
    assert.match(accountHint('key', { ...ready, available: { sign_in: true, key: true } }), /\$0\.08 a minute/)
    assert.match(accountHint('sign-in', { ...ready, available: { sign_in: false, key: true } }), /no Grok sign-in/)
  })
})
