import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SignInError, type OAuthAuth } from './auth.ts'
import { createKeeper, refreshDelayMs } from './keeper.ts'
import type { ServerConfig } from './server.ts'

const BASE = 'http://hermes.test:9119'
const oauth = (n: number, expiresAt: number): OAuthAuth => ({ kind: 'oauth', accessToken: `at-${n}`, refreshToken: `rt-${n}`, expiresAt, provider: 'basic', user: 'alex' })

function harness(initial: ServerConfig | null, nowS = 1_000) {
  let config = initial
  let now = nowS
  const applied: ServerConfig[] = []
  const refreshed: string[] = []
  let gate: Promise<void> = Promise.resolve()
  let failWith: Error | null = null
  let seq = 100

  const keeper = createKeeper({
    getConfig: () => config,
    apply: async next => {
      config = next
      applied.push(next)
    },
    nowS: () => now,
    refresh: async (_base, auth) => {
      refreshed.push(auth.refreshToken)
      await gate
      if (failWith) throw failWith
      return { ...auth, accessToken: `at-${++seq}`, refreshToken: `rt-${seq}`, expiresAt: now + 3600 }
    },
  })

  return {
    keeper,
    applied,
    refreshed,
    get config() {
      return config
    },
    set config(next: ServerConfig | null) {
      config = next
    },
    hold() {
      let release!: () => void
      gate = new Promise<void>(resolve => (release = resolve))

      return release
    },
    fail(error: Error | null) {
      failWith = error
    },
    advance(seconds: number) {
      now += seconds
    },
  }
}

describe('token keeper', () => {
  it('leaves a loopback token config alone', async () => {
    const h = harness({ baseUrl: BASE, auth: { kind: 'token', token: 'abc' } })
    assert.equal(await h.keeper.fresh(), h.config)
    assert.deepEqual(h.refreshed, [])
  })

  it('returns null when nobody is signed in', async () => {
    assert.equal(await harness(null).keeper.fresh(), null)
  })

  it('does not refresh a token that is good for a while', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000 + 3600) })
    await h.keeper.fresh()
    assert.deepEqual(h.refreshed, [])
  })

  it('refreshes inside the two-minute margin, then publishes the new tokens', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000 + 90) })
    const next = await h.keeper.fresh()
    assert.deepEqual(h.refreshed, ['rt-1'])
    assert.equal(h.applied.length, 1)
    assert.equal(next?.auth.kind === 'oauth' && next.auth.accessToken, 'at-101')
    assert.equal(h.config, next)
  })

  it('shares one refresh between callers who ask at the same time', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000) })
    const release = h.hold()
    const calls = [h.keeper.fresh(), h.keeper.fresh(), h.keeper.fresh(true)]
    release()
    const results = await Promise.all(calls)
    assert.deepEqual(h.refreshed, ['rt-1'], 'the single-use refresh token was spent once')
    assert.equal(h.applied.length, 1)
    assert.ok(results.every(result => result === results[0]))
  })

  it('a caller after the refresh sees the new tokens and does not refresh again', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000) })
    await h.keeper.fresh()
    await h.keeper.fresh()
    assert.equal(h.refreshed.length, 1)
  })

  it('force refreshes a token that still looks valid (the server rejected it early)', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000 + 3600) })
    await h.keeper.fresh(true)
    assert.deepEqual(h.refreshed, ['rt-1'])
  })

  it('an expired session rejects and leaves the stored config for the caller to clear', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000) })
    h.fail(new SignInError('expired', 'Your session has expired. Sign in again.'))
    await assert.rejects(h.keeper.fresh(), (error: SignInError) => error.kind === 'expired')
    assert.equal(h.applied.length, 0)
  })

  it('a failed refresh does not poison the next attempt', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000) })
    h.fail(new SignInError('unreachable', 'offline'))
    await assert.rejects(h.keeper.fresh(), (error: SignInError) => error.kind === 'unreachable')
    h.fail(null)
    const next = await h.keeper.fresh()
    assert.equal(next?.auth.kind === 'oauth' && next.auth.accessToken, 'at-101')
    assert.deepEqual(h.refreshed, ['rt-1', 'rt-1'], 'the token was not spent by the failed attempt')
  })

  it('drops the result if the user signed out while it was in the air', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000) })
    const release = h.hold()
    const pending = h.keeper.fresh()
    h.config = null
    release()
    assert.equal(await pending, null)
    assert.equal(h.applied.length, 0, 'nothing is stored for a session that is gone')
  })

  it('drops the result if the user signed in as someone else in the meantime', async () => {
    const h = harness({ baseUrl: BASE, auth: oauth(1, 1_000) })
    const release = h.hold()
    const pending = h.keeper.fresh()
    const other: ServerConfig = { baseUrl: BASE, auth: oauth(7, 99_999) }
    h.config = other
    release()
    assert.equal(await pending, other)
    assert.equal(h.applied.length, 0)
  })

  it('schedules the next refresh two minutes before expiry, never sooner than 30 s', () => {
    assert.equal(refreshDelayMs(oauth(1, 4_600), 1_000), (4_600 - 120 - 1_000) * 1000)
    assert.equal(refreshDelayMs(oauth(1, 1_050), 1_000), 30_000)
    assert.equal(refreshDelayMs(oauth(1, 100), 1_000), 30_000, 'already expired')
    assert.equal(refreshDelayMs(oauth(1, 1_060), 1_000), 30_000, 'a 60 s token (the server minimum) refreshes twice per life, not in a loop')
  })
})
