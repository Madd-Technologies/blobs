import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { GatewayEvent } from './gateway-client.ts'
import { advertiseServerRequests, createRequestBridge, METHOD_NOT_FOUND, type RequestTransport, type ServerRequestFrame } from './server-requests.ts'

/** A transport that records what the bridge writes, and lets a test play the server. */
function fakeTransport() {
  const requestHandlers = new Set<(frame: ServerRequestFrame) => void>()
  const eventHandlers = new Set<(event: GatewayEvent) => void>()
  const responses: { id: string | number; result?: unknown; error?: { code: number; message: string } }[] = []
  let open = true

  const transport: RequestTransport = {
    onServerRequest: handler => (requestHandlers.add(handler), () => requestHandlers.delete(handler)),
    onAny: handler => (eventHandlers.add(handler), () => eventHandlers.delete(handler)),
    respond: (id, result) => (open ? (responses.push({ id, result }), true) : false),
    respondError: (id, code, message) => (open ? (responses.push({ id, error: { code, message } }), true) : false),
  }

  return {
    transport,
    responses,
    request: (frame: ServerRequestFrame) => requestHandlers.forEach(handler => handler(frame)),
    event: (event: GatewayEvent) => eventHandlers.forEach(handler => handler(event)),
    close: () => (open = false),
  }
}

function listen(bridge: ReturnType<typeof createRequestBridge>) {
  const seen: GatewayEvent[] = []
  bridge.onEvent(event => seen.push(event))

  return seen
}

const SID = 'live1'

describe('approval requests', () => {
  const frame: ServerRequestFrame = {
    id: 'srq-aaa111',
    method: 'approval',
    params: { session_id: SID, request_id: 'req-9', command: 'rm -r /tmp/x', description: 'recursive delete', choices: ['once', 'session', 'deny'], allow_permanent: false },
  }

  it('shows up as the approval event the transcript already understands, keyed by the server queue id', () => {
    const fake = fakeTransport()
    const seen = listen(createRequestBridge(fake.transport))
    fake.request(frame)

    assert.equal(seen.length, 1)
    assert.equal(seen[0]?.type, 'approval.request')
    assert.equal(seen[0]?.session_id, SID)
    assert.deepEqual(seen[0]?.payload, { request_id: 'req-9', command: 'rm -r /tmp/x', description: 'recursive delete', choices: ['once', 'session', 'deny'], allow_permanent: false })
  })

  it('is answered as the response to that request, not as an RPC', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    fake.request(frame)

    assert.equal(bridge.answer('req-9', { kind: 'approval', choice: 'session' }), 'sent')
    assert.deepEqual(fake.responses, [{ id: 'srq-aaa111', result: { choice: 'session' } }])
  })

  it('answers once: a second answer finds nothing open', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    fake.request(frame)
    bridge.answer('req-9', { kind: 'approval', choice: 'once' })

    assert.equal(bridge.answer('req-9', { kind: 'approval', choice: 'deny' }), 'unknown')
    assert.equal(fake.responses.length, 1)
  })

  it('reports a closed socket as failed and keeps the prompt answerable', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    fake.request(frame)
    fake.close()

    assert.equal(bridge.answer('req-9', { kind: 'approval', choice: 'once' }), 'failed')
  })

  it('a prompt that did not come as a request is for the RPC to answer', () => {
    const bridge = createRequestBridge(fakeTransport().transport)
    assert.equal(bridge.answer('some-0.21.0-prompt', { kind: 'approval', choice: 'once' }), 'unknown')
  })

  it('falls back to the frame id when the payload has no queue id', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    fake.request({ id: 'srq-bbb', method: 'approval', params: { session_id: SID, command: 'x' } })

    assert.equal((seen[0]?.payload as { request_id: string }).request_id, 'srq-bbb')
    assert.equal(bridge.answer('srq-bbb', { kind: 'approval', choice: 'deny' }), 'sent')
  })
})

describe('clarify requests', () => {
  it('one question is answered as {answer}', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    fake.request({ id: 'srq-c1', method: 'clarify', params: { session_id: SID, question: 'Which?', choices: ['A', 'B'] } })

    assert.equal(seen[0]?.type, 'clarify.request')
    assert.equal((seen[0]?.payload as { request_id: string }).request_id, 'srq-c1')
    bridge.answer('srq-c1', { kind: 'clarify', answers: [{ answer: 'A' }] })
    assert.deepEqual(fake.responses, [{ id: 'srq-c1', result: { answer: 'A' } }])
  })

  it('a batch is answered as {answers} keyed by question id', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    fake.request({ id: 'srq-c2', method: 'clarify', params: { session_id: SID, questions: [{ qid: 'q0', question: 'One?' }, { qid: 'q1', question: 'Two?', multi_select: true }] } })
    bridge.answer('srq-c2', { kind: 'clarify', answers: [{ questionId: 'q0', answer: 'yes' }, { questionId: 'q1', answer: '["a","b"]' }] })

    assert.deepEqual(fake.responses, [{ id: 'srq-c2', result: { answers: { q0: 'yes', q1: '["a","b"]' } } }])
  })
})

describe('sudo and secret requests', () => {
  it('sudo carries no value in the event and is answered as {value}', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    fake.request({ id: 'srq-s1', method: 'sudo', params: { session_id: SID, command: 'apt-get install x' } })

    assert.equal(seen[0]?.type, 'sudo.request')
    assert.deepEqual(seen[0]?.payload, { request_id: 'srq-s1' }, 'the command is not copied into the event')
    bridge.answer('srq-s1', { kind: 'value', value: 'hunter2' })
    assert.deepEqual(fake.responses, [{ id: 'srq-s1', result: { value: 'hunter2' } }])
  })

  it('secret names the variable and is answered as {value}; an empty value is a skip', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    fake.request({ id: 'srq-k1', method: 'secret', params: { session_id: SID, env_var: 'GITHUB_TOKEN', prompt: 'Token for GitHub' } })

    assert.deepEqual(seen[0]?.payload, { request_id: 'srq-k1', prompt: 'Token for GitHub', env_var: 'GITHUB_TOKEN' })
    bridge.answer('srq-k1', { kind: 'value', value: '' })
    assert.deepEqual(fake.responses, [{ id: 'srq-k1', result: { value: '' } }])
  })
})

describe('everything else the server may ask', () => {
  it('a method this client does not handle is refused at once, so the agent does not wait out its deadline', () => {
    const fake = fakeTransport()
    createRequestBridge(fake.transport)
    fake.request({ id: 'srq-v1', method: 'vault.unlock_prompt', params: { session_id: SID, backend: '1password', display_name: '1Password' } })

    assert.equal(fake.responses[0]?.id, 'srq-v1')
    assert.equal(fake.responses[0]?.error?.code, METHOD_NOT_FOUND)
  })

  it('a registered method goes to its handler instead', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const got: string[] = []
    bridge.onRequest('display.install.sudo', frame => got.push(String(frame.id)))
    fake.request({ id: 'srq-d1', method: 'display.install.sudo', params: { session_id: '', profile_key: '~/.hermes' } })

    assert.deepEqual(got, ['srq-d1'])
    assert.deepEqual(fake.responses, [])
    bridge.respond('srq-d1', { value: '' })
    assert.deepEqual(fake.responses, [{ id: 'srq-d1', result: { value: '' } }])
  })
})

describe('request.cancel', () => {
  const cancel = (id: string, method: string): GatewayEvent => ({ type: 'request.cancel' as GatewayEvent['type'], session_id: SID, payload: { id, method, reason: 'timeout' } })

  it('expires the matching prompt, using the id the transcript knows it by', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    fake.request({ id: 'srq-a1', method: 'approval', params: { session_id: SID, request_id: 'req-1', command: 'x' } })
    fake.event(cancel('srq-a1', 'approval'))

    const expire = seen.find(event => event.type === ('approval.expire' as GatewayEvent['type']))
    assert.deepEqual(expire?.payload, { request_id: 'req-1' })
    assert.equal(expire?.session_id, SID)
  })

  it('a cancelled prompt can no longer be answered', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    fake.request({ id: 'srq-q1', method: 'clarify', params: { session_id: SID, question: 'Which?' } })
    fake.event(cancel('srq-q1', 'clarify'))

    assert.equal(bridge.answer('srq-q1', { kind: 'clarify', answers: [{ answer: 'A' }] }), 'unknown')
  })

  it('a cancel for something we never saw is ignored', () => {
    const fake = fakeTransport()
    const seen = listen(createRequestBridge(fake.transport))
    fake.event(cancel('srq-zzz', 'approval'))

    assert.equal(seen.filter(event => event.type.endsWith('.expire')).length, 0)
  })
})

describe('after a reconnect', () => {
  it('re-delivers the requests the server still holds open, and they can be answered on the new connection', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    bridge.ingest(SID, [{ id: 'srq-r1', method: 'clarify', params: { session_id: SID, question: 'Still there?', answers: {} } }])

    assert.equal(seen[0]?.type, 'clarify.request')
    assert.equal(bridge.answer('srq-r1', { kind: 'clarify', answers: [{ answer: 'yes' }] }), 'sent')
  })

  it('delivering the same request again is harmless: it is the same prompt id', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    const entry = { id: 'srq-r2', method: 'approval', params: { request_id: 'req-2', command: 'x' } }
    bridge.ingest(SID, [entry])
    bridge.ingest(SID, [entry])

    const ids = seen.map(event => (event.payload as { request_id: string }).request_id)
    assert.deepEqual(ids, ['req-2', 'req-2'])
    assert.equal(bridge.answer('req-2', { kind: 'approval', choice: 'once' }), 'sent')
    assert.equal(fake.responses.length, 1)
  })

  it('takes the session from the snapshot when an entry does not carry it', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen = listen(bridge)
    bridge.ingest('liveX', [{ id: 'srq-r3', method: 'sudo', params: {} }])

    assert.equal(seen[0]?.session_id, 'liveX')
  })

  it('ignores a snapshot that is not a list or has malformed entries', () => {
    const bridge = createRequestBridge(fakeTransport().transport)
    const seen = listen(bridge)
    bridge.ingest(SID, undefined)
    bridge.ingest(SID, 'nope')
    bridge.ingest(SID, [null, { id: 1 }, { method: 'sudo' }])

    assert.equal(seen.length, 0)
  })
})

describe('listening', () => {
  it('real events pass straight through, and unsubscribing stops both kinds', () => {
    const fake = fakeTransport()
    const bridge = createRequestBridge(fake.transport)
    const seen: GatewayEvent[] = []
    const stop = bridge.onEvent(event => seen.push(event))
    fake.event({ type: 'message.start', session_id: SID })
    stop()
    fake.event({ type: 'message.start', session_id: SID })
    fake.request({ id: 'srq-l1', method: 'sudo', params: { session_id: SID } })

    assert.equal(seen.length, 1)
  })
})

describe('advertising the capability', () => {
  it('tells the server this client answers requests, and returns what the server may send', async () => {
    const calls: unknown[] = []
    const methods = await advertiseServerRequests({
      request: async <T>(method: string, params?: Record<string, unknown>) => (calls.push([method, params]), { server_requests: ['approval', 'clarify'] } as T),
    })

    assert.deepEqual(calls, [['client.capabilities', { server_requests: true }]])
    assert.deepEqual(methods, ['approval', 'clarify'])
  })

  it('an older server without the method is not an error: it keeps using events', async () => {
    const methods = await advertiseServerRequests({
      request: async () => {
        throw Object.assign(new Error('method not found'), { code: -32601 })
      },
    })

    assert.deepEqual(methods, [])
  })
})
