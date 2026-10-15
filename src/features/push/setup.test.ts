import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PushDevice, PushLevel, PushSettings, PushStatus } from '../../lib/hermes/push-api.ts'
import { createPushSetup, INSTANCE, registrationFailure, type Distributor, type NativePush, type PushEvent, type PushServer } from './setup.ts'

const VAPID = 'V'.repeat(87)
const ntfy: Distributor = { id: 'io.heckel.ntfy', name: 'ntfy' }
const firebase: Distributor = { id: 'embedded-fcm', name: 'Firebase', isInternal: true }

function fakeNative(options: { distributors?: Distributor[]; saved?: string | null; permission?: string; answer?: PushEvent | 'silent' | 'throws' } = {}) {
  const listeners = new Set<(event: PushEvent) => void>()
  const log: string[] = []
  let saved = options.saved ?? null
  const emit = (event: PushEvent) => [...listeners].forEach(listener => listener(event))

  const native: NativePush = {
    getDistributors: () => options.distributors ?? [ntfy, firebase],
    getSavedDistributor: () => saved,
    saveDistributor: id => {
      saved = id
      log.push(`save ${id}`)
    },
    async register(instance, vapid) {
      log.push(`register ${instance} ${vapid}`)

      if (options.answer === 'throws') {
        throw new Error('Cannot register for notifications while running on an emulator')
      }

      const reply = options.answer ?? { action: 'registered' as const, data: { url: 'https://ntfy.example/upAbc', pubKey: 'PUB', auth: 'AUTH', instance: INSTANCE } }

      if (reply !== 'silent') {
        queueMicrotask(() => emit(reply))
      }
    },
    unregister: instance => log.push(`unregister ${instance}`),
    requestPermissions: async () => options.permission ?? 'granted',
    subscribe(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
  }

  return { native, log, emit, listeners }
}

function fakeServer(initial: Partial<PushStatus> | null = { devices: [], settings: { default: 'all', bots: {} } }) {
  const calls: string[] = []
  const state = { status: initial, vapid: VAPID as string | undefined, devices: [...(initial?.devices ?? [])], settings: initial?.settings ?? ({ default: 'all', bots: {} } as PushSettings), testGone: false, testOk: true, failLevels: false }
  const device = (id: string): PushDevice => ({ id, name: 'Phone', host: 'ntfy.example', created: 1, last_ok: null, last_error: null })

  const server: PushServer = {
    async status() {
      return state.status === null ? null : { devices: state.devices, settings: state.settings, vapid: state.vapid }
    },
    async add(body) {
      calls.push(`add ${body.endpoint} ${body.p256dh} ${body.auth} ${body.name}`)
      const row = device('dev1')
      state.devices = [row]
      state.status = { devices: state.devices, settings: state.settings }

      return row
    },
    async remove(id) {
      calls.push(`remove ${id}`)
      state.devices = state.devices.filter(row => row.id !== id)
    },
    async setLevels(change) {
      calls.push(`levels ${JSON.stringify(change)}`)

      if (state.failLevels) {
        throw new Error('nope')
      }

      const bots: Record<string, PushLevel> = { ...state.settings.bots }

      for (const [name, level] of Object.entries(change.bots ?? {})) {
        if (level === null) {
          delete bots[name]
        } else {
          bots[name] = level
        }
      }

      state.settings = { default: change.default ?? state.settings.default, bots }

      return state.settings
    },
    async test(id) {
      calls.push(`test ${id}`)

      return [{ device: id, ok: state.testOk && !state.testGone, status: state.testGone ? 410 : 201, error: state.testOk ? null : 'http 503', gone: state.testGone }]
    },
  }

  return { server, calls, state }
}

function setup(native: NativePush | null, server: PushServer, stored: { id: string | null } = { id: null }) {
  return createPushSetup({
    native,
    server,
    deviceName: () => 'google Pixel 8',
    loadMine: async () => stored.id,
    saveMine: async id => {
      stored.id = id
    },
    registrationTimeoutMs: 30,
  })
}

describe('where notifications are possible', () => {
  it('is unsupported without a push library', async () => {
    const push = setup(null, fakeServer().server)
    await push.refresh()
    assert.equal(push.store.getState().phase.kind, 'unsupported')
  })

  it('says so when the server lacks the plugin', async () => {
    const push = setup(fakeNative().native, fakeServer(null).server)
    await push.refresh()
    assert.equal(push.store.getState().phase.kind, 'no-plugin')
  })

  it('is off until this phone is registered', async () => {
    const push = setup(fakeNative().native, fakeServer().server)
    await push.refresh()
    assert.equal(push.store.getState().phase.kind, 'off')
  })

  it('forgets a stored id the server no longer has', async () => {
    const stored = { id: 'gone' }
    const push = setup(fakeNative().native, fakeServer().server, stored)
    await push.refresh()
    assert.equal(push.store.getState().phase.kind, 'off')
    assert.equal(stored.id, null)
  })

  it('is on when the server still lists this phone', async () => {
    const server = fakeServer({ devices: [{ id: 'dev1', name: 'Phone', host: null, created: 1, last_ok: null, last_error: null }], settings: { default: 'all', bots: {} } })
    const push = setup(fakeNative().native, server.server, { id: 'dev1' })
    await push.refresh()
    assert.equal(push.store.getState().phase.kind, 'on')
    assert.equal(push.store.getState().mine, 'dev1')
  })
})

describe('turning notifications on', () => {
  it('walks permission, push app, registration and the server, then is on', async () => {
    const { native, log } = fakeNative()
    const { server, calls } = fakeServer()
    const stored = { id: null as string | null }
    const push = setup(native, server, stored)
    await push.enable()
    assert.deepEqual(log, ['save io.heckel.ntfy', `register ${INSTANCE} ${VAPID}`])
    assert.deepEqual(calls, ['add https://ntfy.example/upAbc PUB AUTH google Pixel 8'])
    assert.equal(stored.id, 'dev1')
    assert.equal(push.store.getState().phase.kind, 'on')
  })

  it('prefers a push app over the built-in Firebase one, even when it is listed first', async () => {
    const { native, log } = fakeNative({ distributors: [firebase, ntfy] })
    await setup(native, fakeServer().server).enable()
    assert.equal(log[0], 'save io.heckel.ntfy')
  })

  it('stops at the missing plugin before asking for anything', async () => {
    const { native, log } = fakeNative()
    const push = setup(native, fakeServer(null).server)
    await push.enable()
    assert.equal(push.store.getState().phase.kind, 'no-plugin')
    assert.deepEqual(log, [])
  })

  it('registers with the server’s VAPID key, which the library insists on', async () => {
    const { native, log } = fakeNative()
    await setup(native, fakeServer().server).enable()
    assert.ok(log.includes(`register ${INSTANCE} ${VAPID}`))
  })

  it('stops, saying the plugin is out of date, when the server has no VAPID key', async () => {
    const { native, log } = fakeNative()
    const server = fakeServer()
    server.state.vapid = undefined
    const push = setup(native, server.server)
    await push.enable()
    const phase = push.store.getState().phase
    assert.equal(phase.kind, 'error')
    assert.match(phase.kind === 'error' ? phase.message : '', /out of date/)
    assert.deepEqual(log, [])
  })

  it('stops when notifications are refused', async () => {
    const push = setup(fakeNative({ permission: 'never_ask_again' }).native, fakeServer().server)
    await push.enable()
    assert.equal(push.store.getState().phase.kind, 'blocked')
  })

  it('asks for a push app when only Firebase is there', async () => {
    const push = setup(fakeNative({ distributors: [firebase] }).native, fakeServer().server)
    await push.enable()
    assert.equal(push.store.getState().phase.kind, 'no-distributor')
  })

  it('asks which push app when there are several, then continues with the choice', async () => {
    const other: Distributor = { id: 'org.other', name: 'Other' }
    const { native, log } = fakeNative({ distributors: [ntfy, other, firebase] })
    const push = setup(native, fakeServer().server)
    await push.enable()
    const phase = push.store.getState().phase
    assert.equal(phase.kind, 'choose-distributor')
    assert.deepEqual(phase.kind === 'choose-distributor' ? phase.options.map(o => o.id) : [], ['io.heckel.ntfy', 'org.other'])

    await push.enable('org.other')
    assert.equal(log[0], 'save org.other')
    assert.equal(push.store.getState().phase.kind, 'on')
  })

  it('reuses the push app it already saved', async () => {
    const other: Distributor = { id: 'org.other', name: 'Other' }
    const { native, log } = fakeNative({ distributors: [ntfy, other], saved: 'org.other' })
    await setup(native, fakeServer().server).enable()
    assert.equal(log[0], 'save org.other')
  })

  it('reports a registration the push app refused, in words', async () => {
    const answer: PushEvent = { action: 'registrationFailed', data: { reason: 'NETWORK', instance: INSTANCE } }
    const push = setup(fakeNative({ answer }).native, fakeServer().server)
    await push.enable()
    assert.deepEqual(push.store.getState().phase, { kind: 'error', message: registrationFailure('NETWORK') })
  })

  it('gives up when the push app never answers', async () => {
    const { native, listeners } = fakeNative({ answer: 'silent' })
    const push = setup(native, fakeServer().server)
    await push.enable()
    const phase = push.store.getState().phase
    assert.equal(phase.kind, 'error')
    assert.match(phase.kind === 'error' ? phase.message : '', /did not answer/)
    assert.equal(listeners.size, 0, 'no listener is left behind')
  })

  it('shows the library’s own error, such as running in an emulator', async () => {
    const push = setup(fakeNative({ answer: 'throws' }).native, fakeServer().server)
    await push.enable()
    const phase = push.store.getState().phase
    assert.match(phase.kind === 'error' ? phase.message : '', /emulator/)
  })

  it('refuses an endpoint without keys, because the server could not encrypt to it', async () => {
    const answer: PushEvent = { action: 'registered', data: { url: 'https://x/up', pubKey: null, auth: null, instance: INSTANCE } }
    const { server, calls } = fakeServer()
    const push = setup(fakeNative({ answer }).native, server)
    await push.enable()
    assert.equal(push.store.getState().phase.kind, 'error')
    assert.deepEqual(calls, [])
  })
})

describe('after it is on', () => {
  async function on() {
    const native = fakeNative()
    const server = fakeServer()
    const stored = { id: null as string | null }
    const push = setup(native.native, server.server, stored)
    await push.enable()
    server.calls.length = 0
    native.log.length = 0

    return { push, native, server, stored }
  }

  it('turning off unregisters, tells the server and forgets the id', async () => {
    const { push, native, server, stored } = await on()
    await push.disable()
    assert.deepEqual(native.log, [`unregister ${INSTANCE}`])
    assert.deepEqual(server.calls, ['remove dev1'])
    assert.equal(stored.id, null)
    assert.equal(push.store.getState().phase.kind, 'off')
  })

  it('turning off still works if the server is unreachable', async () => {
    const { push, server, stored } = await on()
    server.server.remove = async () => {
      throw new Error('down')
    }
    await push.disable()
    assert.equal(stored.id, null)
  })

  it('a test push that arrives says so', async () => {
    const { push } = await on()
    await push.sendTest()
    assert.deepEqual(push.store.getState().test, { ok: true, message: 'Sent. It should arrive in a few seconds.' })
  })

  it('a test the push service rejects says which answer', async () => {
    const { push, server } = await on()
    server.state.testOk = false
    await push.sendTest()
    assert.equal(push.store.getState().test?.ok, false)
    assert.match(push.store.getState().test?.message ?? '', /http 503/)
  })

  it('a test that finds the subscription gone turns notifications off and says to start again', async () => {
    const { push, server } = await on()
    server.state.testGone = true
    server.state.devices = []
    await push.sendTest()
    assert.equal(push.store.getState().phase.kind, 'off')
    assert.match(push.store.getState().test?.message ?? '', /Turn notifications on again/)
  })

  it('sets a bot’s level at once and keeps what the server answers', async () => {
    const { push, server } = await on()
    const seen: string[] = []
    push.store.subscribe(state => seen.push(state.settings.bots.juniper ?? '-'))
    await push.setLevel('juniper', 'off')
    assert.equal(seen[0], 'off', 'shown before the server answers')
    assert.deepEqual(push.store.getState().settings.bots, { juniper: 'off' })
    assert.deepEqual(server.calls, ['levels {"bots":{"juniper":"off"}}'])

    await push.setLevel('juniper', null)
    assert.deepEqual(push.store.getState().settings.bots, {})
  })

  it('takes a level back when the server refuses it', async () => {
    const { push, server } = await on()
    server.state.failLevels = true
    await push.setLevel('juniper', 'off')
    assert.deepEqual(push.store.getState().settings.bots, {})
    assert.equal(push.store.getState().phase.kind, 'error')
  })

  it('changes the default', async () => {
    const { push } = await on()
    await push.setDefault('needs_you')
    assert.equal(push.store.getState().settings.default, 'needs_you')
  })
})

describe('staying registered', () => {
  it('registers again at launch when the phone is on, and re-sends an endpoint the push app moved', async () => {
    const native = fakeNative()
    const server = fakeServer({ devices: [{ id: 'dev1', name: 'Phone', host: null, created: 1, last_ok: null, last_error: null }], settings: { default: 'all', bots: {} } })
    const push = setup(native.native, server.server, { id: 'dev1' })
    await push.refresh()
    push.start()
    assert.deepEqual(native.log, [`register ${INSTANCE} ${VAPID}`])

    // Registering again makes the push app report its endpoint again; the server hears it (it is idempotent there).
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(server.calls, ['add https://ntfy.example/upAbc PUB AUTH google Pixel 8'])
    server.calls.length = 0

    native.emit({ action: 'registered', data: { url: 'https://ntfy.example/moved', pubKey: 'P2', auth: 'A2', instance: INSTANCE } })
    await Promise.resolve()
    assert.deepEqual(server.calls, ['add https://ntfy.example/moved P2 A2 google Pixel 8'])
    push.stop()
    assert.equal(native.listeners.size, 0)
  })

  it('does nothing at launch when notifications are off', async () => {
    const native = fakeNative()
    const push = setup(native.native, fakeServer().server)
    await push.refresh()
    push.start()
    assert.deepEqual(native.log, [])
    push.stop()
  })

  it('warns when the push app drops the phone', async () => {
    const native = fakeNative()
    const server = fakeServer({ devices: [{ id: 'dev1', name: 'Phone', host: null, created: 1, last_ok: null, last_error: null }], settings: { default: 'all', bots: {} } })
    const push = setup(native.native, server.server, { id: 'dev1' })
    await push.refresh()
    push.start()
    native.emit({ action: 'unregistered', data: { instance: INSTANCE } })
    assert.equal(push.store.getState().phase.kind, 'error')
    push.stop()
  })
})
