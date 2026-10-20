import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { answerCall, approveErrand, getErrand, getPhoneStatus, listErrands, PhoneRefusal, phoneRefusal, setPhoneSettings, type Errand } from './phone.ts'
import { HermesHttpError, type ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'https://h.ts.net', auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } }
const realFetch = globalThis.fetch

const errand: Errand = {
  id: 'e_1',
  profile: 'harbor',
  session_id: 's_1',
  created: 1_000,
  status: 'pending',
  brief: { title: 'Septic pumping quotes', mode: 'quote', goal: 'Get a price.', opening: '', facts: [], questions: [], record: [], accept: '', notes: '', calls: [] },
  flags: [],
  ticked: [],
  decided: null,
  calls: [],
}

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

describe('getPhoneStatus', () => {
  it('reads the plugin’s status', async () => {
    const status = { version: '0.1.0', service: { running: true, live: 0 }, line: { set: true, number: '…41' }, public_url: true, stage: 'test' }
    const calls = answer(() => ({ body: status }))

    assert.deepEqual(await getPhoneStatus(config), status)
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/plugins/hermes-phone/status')
  })

  it('is null when the server has no hermes-phone', async () => {
    answer(() => ({ status: 404, body: { detail: 'Not Found' } }))

    assert.equal(await getPhoneStatus(config), null)
  })

  it('is null for an answer that is not a status', async () => {
    answer(() => ({ body: { hello: 'world' } }))

    assert.equal(await getPhoneStatus(config), null)
  })
})

describe('listErrands', () => {
  it('keeps only rows with an id', async () => {
    answer(() => ({ body: { errands: [{ id: 'e_1', title: 'A' }, { title: 'no id' }, null] } }))

    assert.deepEqual((await listErrands(config)).map(row => row.id), ['e_1'])
  })
})

describe('approveErrand', () => {
  it('posts what you ticked and struck, as indexes into the brief as sent', async () => {
    const calls = answer(() => ({ body: { ...errand, status: 'approved' } }))

    assert.equal((await approveErrand(config, 'e_1', { ticked: [2], remove_facts: [0], remove_calls: [1] })).status, 'approved')
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/plugins/hermes-phone/errands/e_1/approve')
    assert.equal(calls[0]?.init.method, 'POST')
    assert.equal(calls[0]?.init.body, JSON.stringify({ ticked: [2], remove_facts: [0], remove_calls: [1] }))
  })

  it('turns the plugin’s refusal into a PhoneRefusal with its message', async () => {
    answer(() => ({ status: 409, body: refusal('unticked', 'Tick or strike the service address first.') }))

    await assert.rejects(approveErrand(config, 'e_1', { ticked: [], remove_facts: [], remove_calls: [] }), (error: unknown) => error instanceof PhoneRefusal && error.reason === 'unticked' && error.status === 409 && error.message === 'Tick or strike the service address first.')
  })

  it('fails plainly on an answer that is not an errand', async () => {
    answer(() => ({ body: { ok: true } }))

    await assert.rejects(approveErrand(config, 'e_1', { ticked: [], remove_facts: [], remove_calls: [] }), /unexpected answer/)
  })
})

describe('getErrand', () => {
  it('escapes the id in the path', async () => {
    const calls = answer(() => ({ body: errand }))

    await getErrand(config, 'e/1')
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/plugins/hermes-phone/errands/e%2F1')
  })
})

describe('answerCall', () => {
  it('sends your answer to the call holding the question', async () => {
    const calls = answer(() => ({ body: errand }))

    await answerCall(config, 'e_1', 'c_2', 'About a foot down.')
    assert.equal(calls[0]?.url, 'https://h.ts.net/api/plugins/hermes-phone/errands/e_1/calls/c_2/answer')
    assert.equal(calls[0]?.init.body, JSON.stringify({ text: 'About a foot down.' }))
  })

  it('passes on a late answer as its own refusal', async () => {
    answer(() => ({ status: 409, body: refusal('late', 'The call stopped waiting for that answer.') }))

    await assert.rejects(answerCall(config, 'e_1', 'c_2', 'Yes'), (error: unknown) => error instanceof PhoneRefusal && error.reason === 'late')
  })
})

describe('setPhoneSettings', () => {
  it('sends a never-share value only to add it', async () => {
    const calls = answer(() => ({ body: { name: 'Alex', never_share: [{ label: 'Gate code', hint: '…42' }] } }))

    await setPhoneSettings(config, { never_share_add: [{ label: 'Gate code', value: '4242' }] })
    assert.equal(calls[0]?.init.method, 'PUT')
    assert.equal(calls[0]?.init.body, JSON.stringify({ never_share_add: [{ label: 'Gate code', value: '4242' }] }))
  })
})

describe('phoneRefusal', () => {
  it('reads a refusal longer than the error message keeps', () => {
    const message = 'x'.repeat(400)
    const body = JSON.stringify(refusal('invalid', message))
    const found = phoneRefusal(new HermesHttpError(400, `PUT /settings → 400 ${body.slice(0, 200)}`, body))

    assert.equal(found?.message, message)
  })

  it('is null for anything that is not the plugin’s refusal', () => {
    assert.equal(phoneRefusal(new Error('offline')), null)
    assert.equal(phoneRefusal(new HermesHttpError(500, 'GET /status → 500 oops', 'oops')), null)
    assert.equal(phoneRefusal(new HermesHttpError(404, 'GET /x → 404', JSON.stringify({ detail: 'Not Found' }))), null)
  })
})
