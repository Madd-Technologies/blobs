import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcGatewayClient, type GatewayEvent, type ServerRequestFrame, type WebSocketLike } from './gateway-client.ts'

class FakeSocket implements WebSocketLike {
  readyState = 0
  readonly sent: Record<string, any>[] = []
  private readonly listeners = new Map<string, ((event: any) => void)[]>()

  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener))
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    this.fire('close', { code: 1000 })
  }
  fire(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  open() {
    this.readyState = 1
    this.fire('open', {})
  }
  /** The server sends a frame. */
  receive(frame: unknown) {
    this.fire('message', { data: JSON.stringify(frame) })
  }
}

async function connected() {
  const socket = new FakeSocket()
  const client = new JsonRpcGatewayClient({ requestIdPrefix: 't', socketFactory: () => socket })
  const connecting = client.connect('ws://h:1/api/ws')
  socket.open()
  await connecting

  return { client, socket }
}

const prompt = (id: string): Record<string, unknown> => ({ jsonrpc: '2.0', id, method: 'approval', params: { session_id: 's1', request_id: 'req-1', command: 'x' } })

describe('requests from the server', () => {
  it('a frame with both an id and a method is a request for us, not the answer to one of our calls', async () => {
    const { client, socket } = await connected()
    const got: ServerRequestFrame[] = []
    client.onServerRequest(frame => got.push(frame))
    socket.receive(prompt('srq-1'))

    assert.equal(got.length, 1)
    assert.equal(got[0]?.id, 'srq-1')
    assert.equal(got[0]?.method, 'approval')
    assert.equal((got[0]?.params as { request_id: string }).request_id, 'req-1')
  })

  it('with no listener it is refused at once, so the server does not wait for an answer that cannot come', async () => {
    const { socket } = await connected()
    socket.receive(prompt('srq-2'))

    assert.deepEqual(socket.sent.at(-1), { jsonrpc: '2.0', id: 'srq-2', error: { code: -32601, message: 'approval is not supported by this client' } })
  })

  it('respond() writes the answer under the request id', async () => {
    const { client, socket } = await connected()
    assert.equal(client.respond('srq-3', { choice: 'once' }), true)
    assert.deepEqual(socket.sent.at(-1), { jsonrpc: '2.0', id: 'srq-3', result: { choice: 'once' } })
  })

  it('respond() says so when the socket is not open', async () => {
    const { client, socket } = await connected()
    socket.readyState = 3
    assert.equal(client.respond('srq-4', {}), false)
    assert.equal(client.respondError('srq-4', -32601, 'no'), false)
  })

  it('an unsubscribed listener no longer hears requests (and the next one is refused)', async () => {
    const { client, socket } = await connected()
    const got: string[] = []
    const stop = client.onServerRequest(frame => got.push(String(frame.id)))
    stop()
    socket.receive(prompt('srq-5'))

    assert.deepEqual(got, [])
    assert.equal(socket.sent.at(-1)?.error?.code, -32601)
  })
})

describe('everything else still works', () => {
  it('answers to our own calls still resolve', async () => {
    const { client, socket } = await connected()
    const pending = client.request<{ pong: boolean }>('ping', {})
    const sent = socket.sent.at(-1)
    socket.receive({ jsonrpc: '2.0', id: sent?.id, result: { pong: true } })

    assert.deepEqual(await pending, { pong: true })
  })

  it('events still dispatch, and are not mistaken for requests', async () => {
    const { client, socket } = await connected()
    const events: GatewayEvent[] = []
    const requests: ServerRequestFrame[] = []
    client.onAny(event => events.push(event))
    client.onServerRequest(frame => requests.push(frame))
    socket.receive({ jsonrpc: '2.0', method: 'event', params: { type: 'message.start', session_id: 's1', seq: 1, payload: {} } })

    assert.equal(events.length, 1)
    assert.equal(requests.length, 0)
  })

  it('an error answer to our call still rejects with its code', async () => {
    const { client, socket } = await connected()
    const pending = client.request('nope', {})
    socket.receive({ jsonrpc: '2.0', id: socket.sent.at(-1)?.id, error: { code: -32601, message: 'method not found' } })

    await assert.rejects(pending, (error: { code?: number }) => error.code === -32601)
  })
})

describe('after a reconnect', () => {
  it('requests the server still holds open arrive with the replay, as if they had just been asked', async () => {
    const first = new FakeSocket()
    const second = new FakeSocket()
    const sockets = [first, second]
    const client = new JsonRpcGatewayClient({ requestIdPrefix: 't', socketFactory: () => sockets.shift() as FakeSocket })

    const a = client.connect('ws://h:1/api/ws')
    first.open()
    await a
    // The client has now seen an event for session s1, so a reconnect replays it.
    first.receive({ jsonrpc: '2.0', method: 'event', params: { type: 'message.start', session_id: 's1', seq: 4, payload: {} } })
    first.close()

    const got: ServerRequestFrame[] = []
    client.onServerRequest(frame => got.push(frame))
    const b = client.connect('ws://h:1/api/ws')
    second.open()
    await b

    const replay = second.sent.find(frame => frame.method === 'session.events.since')
    assert.ok(replay, 'asked the server what it missed')
    second.receive({ jsonrpc: '2.0', id: replay.id, result: { events: [], open_requests: [{ id: 'srq-9', method: 'clarify', params: { session_id: 's1', question: 'Still there?' } }] } })
    await new Promise(resolve => setTimeout(resolve, 5))

    assert.deepEqual(got.map(frame => [frame.id, frame.method]), [['srq-9', 'clarify']])
    assert.equal((got[0]?.params as { session_id: string }).session_id, 's1')
  })
})
