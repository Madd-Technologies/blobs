import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { JsonRpcGatewayClient } from './gateway-client.ts'
import { gatewayWsUrl, HermesHttpError, normalizeBaseUrl, probeServer, restHeaders, type ServerConfig } from './server.ts'

const tokenConfig: ServerConfig = {
  baseUrl: 'http://127.0.0.1:9119',
  auth: { kind: 'token', token: 'a b&c' },
}

describe('normalizeBaseUrl', () => {
  it('adds http:// and strips trailing slashes', () => {
    assert.equal(normalizeBaseUrl(' 192.168.1.20:9119/ '), 'http://192.168.1.20:9119')
    assert.equal(normalizeBaseUrl('https://hermes.tail.ts.net//'), 'https://hermes.tail.ts.net')
  })
})

describe('restHeaders', () => {
  it('uses the session-token header in loopback mode', () => {
    assert.deepEqual(restHeaders(tokenConfig), { 'X-Hermes-Session-Token': 'a b&c' })
  })

  it('uses a bearer token in gated mode', () => {
    const oauth: ServerConfig = {
      baseUrl: 'https://x.ts.net',
      auth: { kind: 'oauth', accessToken: 't', refreshToken: 'r', expiresAt: 0 },
    }
    assert.deepEqual(restHeaders(oauth), { Authorization: 'Bearer t' })
  })
})

describe('gatewayWsUrl', () => {
  it('maps http→ws and url-encodes the token', async () => {
    assert.equal(await gatewayWsUrl(tokenConfig), 'ws://127.0.0.1:9119/api/ws?token=a%20b%26c')
  })

  it('maps https→wss', async () => {
    const url = await gatewayWsUrl({ baseUrl: 'https://h.ts.net', auth: { kind: 'token', token: 't' } })
    assert.equal(url, 'wss://h.ts.net/api/ws?token=t')
  })
})

describe('HermesHttpError', () => {
  it('keeps the status as a plain field (erasableSyntaxOnly)', () => {
    const error = new HermesHttpError(404, 'nope')
    assert.equal(error.status, 404)
    assert.equal(error.name, 'HermesHttpError')
    assert.ok(error instanceof Error)
  })
})

describe('vendored gateway client', () => {
  it('loads under plain Node with no React Native imports', () => {
    const client = new JsonRpcGatewayClient({ requestIdPrefix: 't' })
    assert.equal(client.connectionState, 'idle')
  })
})

describe('probeServer', () => {
  const reply = (routes: Record<string, { status: number; body?: unknown }>) =>
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      const hit = routes[path] ?? { status: 404 }

      return new Response(hit.body === undefined ? null : JSON.stringify(hit.body), { status: hit.status })
    })

  it('accepts a dashboard gateway and reports whether it wants a login', async () => {
    const stub = reply({ '/api/status': { status: 200, body: { version: '0.21.0', auth_required: false } } })
    assert.deepEqual(await probeServer('http://h:9119'), { ok: true, authRequired: false, version: '0.21.0' })
    stub.mock.restore()
  })

  it('recognizes Hermes’s API server (port 8642) and says so', async () => {
    const stub = reply({ '/health': { status: 200, body: { status: 'ok', platform: 'hermes-agent', version: '0.21.3' } } })
    assert.deepEqual(await probeServer('http://h:8642'), { ok: false, error: 'HTTP 404', apiServer: true })
    stub.mock.restore()
  })

  it('reports an unrelated 404 as an HTTP error, not as unreachable', async () => {
    const stub = reply({})
    assert.deepEqual(await probeServer('http://h:80'), { ok: false, error: 'HTTP 404' })
    stub.mock.restore()
  })

  it('reports a network failure with its reason', async () => {
    const stub = mock.method(globalThis, 'fetch', async () => {
      throw new Error('Network request failed')
    })
    assert.deepEqual(await probeServer('http://h:9119'), { ok: false, error: 'Network request failed' })
    stub.mock.restore()
  })
})
