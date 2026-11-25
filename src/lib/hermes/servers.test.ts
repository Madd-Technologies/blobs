import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  defaultServerLabel,
  EMPTY_SERVER_INDEX,
  nextActiveServer,
  parseServerIndex,
  removeServerMeta,
  renameServerMeta,
  serverKey,
  upsertServerMeta,
} from './servers.ts'

describe('multi-server index helpers', () => {
  it('builds per-server SecureStore keys and default labels', () => {
    assert.equal(serverKey('srv-1'), 'hermesbot.server.srv-1')
    assert.equal(defaultServerLabel('https://home-server.ts.net/'), 'home-server.ts.net')
    assert.equal(defaultServerLabel('http://100.64.0.1:9119/'), '100.64.0.1:9119')
  })

  it('upserts new servers and updates existing ones by normalized URL', () => {
    const first = upsertServerMeta(
      EMPTY_SERVER_INDEX,
      { baseUrl: 'https://home-server.ts.net/', auth: { kind: 'token', token: 't1' } },
      { id: 'srv-a', now: 1000 },
    )
    assert.equal(first.index.activeId, 'srv-a')
    assert.equal(first.server.baseUrl, 'https://home-server.ts.net')
    assert.equal(first.server.label, 'home-server.ts.net')

    const second = upsertServerMeta(
      first.index,
      { baseUrl: 'http://100.64.0.1:9119', auth: { kind: 'oauth', accessToken: 'a', refreshToken: 'r', expiresAt: 9999, user: 'orion' } },
      { id: 'srv-b', label: 'Lab', now: 2000 },
    )
    assert.equal(second.index.servers.length, 2)
    assert.equal(second.index.activeId, 'srv-b')
    assert.equal(second.server.user, 'orion')
    assert.equal(second.server.label, 'Lab')

    const updated = upsertServerMeta(
      second.index,
      { baseUrl: 'https://home-server.ts.net', auth: { kind: 'token', token: 't2' } },
      { now: 3000 },
    )
    assert.equal(updated.index.servers.length, 2)
    assert.equal(updated.index.activeId, 'srv-a')
    assert.equal(updated.server.lastConnectedAt, 3000)
  })

  it('renames and removes servers with fallback to most recently connected server', () => {
    const a = upsertServerMeta(EMPTY_SERVER_INDEX, { baseUrl: 'https://a.example', auth: { kind: 'token', token: '1' } }, { id: 'a', now: 100 })
    const b = upsertServerMeta(a.index, { baseUrl: 'https://b.example', auth: { kind: 'token', token: '2' } }, { id: 'b', now: 200 })
    const c = upsertServerMeta(b.index, { baseUrl: 'https://c.example', auth: { kind: 'token', token: '3' } }, { id: 'c', now: 300 })

    const renamed = renameServerMeta(c.index, 'b', 'Work')
    assert.equal(renamed.servers.find(s => s.id === 'b')?.label, 'Work')

    // Removing active ('c') falls back to 'b' (most recently connected).
    assert.equal(nextActiveServer(renamed, 'c')?.id, 'b')
    const afterC = removeServerMeta(renamed, 'c')
    assert.equal(afterC.activeId, 'b')
    assert.equal(afterC.servers.length, 2)

    // Removing non-active ('a') keeps 'b' active.
    const afterA = removeServerMeta(afterC, 'a')
    assert.equal(afterA.activeId, 'b')

    // Removing last server yields unconfigured.
    const empty = removeServerMeta(afterA, 'b')
    assert.equal(empty.activeId, null)
    assert.deepEqual(empty.servers, [])
  })

  it('parses malformed or missing JSON safely', () => {
    assert.deepEqual(parseServerIndex(null), EMPTY_SERVER_INDEX)
    assert.deepEqual(parseServerIndex('{bad'), EMPTY_SERVER_INDEX)

    const valid = parseServerIndex(
      JSON.stringify({
        activeId: 'missing',
        servers: [{ id: 's1', label: 'Home', baseUrl: 'https://home-server.ts.net', addedAt: 1, lastConnectedAt: 2 }],
      }),
    )
    assert.equal(valid.activeId, 's1')
    assert.equal(valid.servers.length, 1)
  })
})
