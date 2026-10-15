import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { appendTranscript, clock, transcribeRecording } from './audio.ts'
import { HermesHttpError, type ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'https://h.ts.net', auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } }
const realFetch = globalThis.fetch

function answer(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const { status = 200, body } = handler(url, init)

    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch

  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('transcribing a recording', () => {
  it('sends the recording as a data URL for the chosen bot and returns the words', async () => {
    const calls = answer(() => ({ body: { ok: true, transcript: '  remind me to call mum  ', provider: 'whisper' } }))
    assert.deepEqual(await transcribeRecording(config, 'QUJD', { profile: 'juniper' }), { text: 'remind me to call mum', provider: 'whisper' })
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/audio/transcribe?profile=juniper')
    assert.equal(calls[0]?.init.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { data_url: 'data:audio/m4a;base64,QUJD', mime_type: 'audio/m4a' })
  })

  it('treats silence as nothing said, not as a failure', async () => {
    answer(() => ({ body: { ok: true, transcript: '', provider: null } }))
    assert.deepEqual(await transcribeRecording(config, 'QUJD'), { text: '', provider: null })
  })

  it('works without a profile', async () => {
    const calls = answer(() => ({ body: { ok: true, transcript: 'hi' } }))
    await transcribeRecording(config, 'QUJD')
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/audio/transcribe')
  })

  it('passes on the server’s reason when it cannot transcribe (no speech recognition set up)', async () => {
    answer(() => ({ status: 400, body: { detail: 'No STT provider configured' } }))
    await assert.rejects(transcribeRecording(config, 'QUJD'), error => error instanceof HermesHttpError && error.status === 400 && /No STT provider/.test(error.message))
  })
})

describe('words', () => {
  it('writes the time of a recording', () => {
    assert.equal(clock(0), '0:00')
    assert.equal(clock(7.9), '0:07')
    assert.equal(clock(65), '1:05')
    assert.equal(clock(-3), '0:00')
  })

  it('adds what was said after what is already in the box', () => {
    assert.equal(appendTranscript('', ' hello '), 'hello')
    assert.equal(appendTranscript('Dear Juniper,  ', 'what is the date'), 'Dear Juniper,\nwhat is the date')
    assert.equal(appendTranscript('keep this', '   '), 'keep this')
  })
})
