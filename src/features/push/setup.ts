/**
 * Turning notifications on and off: the walk from "nothing" to "this phone is registered on the server and a bot
 * that needs you will buzz it". Framework-free, with the phone's push library and the server behind small
 * interfaces so the walk can be tested without either.
 *
 * The pieces, in order: the server must have the `hermes-bot-mobile` plugin (or the older `hermes-push`); the app needs Android's notification
 * permission; a UnifiedPush app on the phone (ntfy, for example) delivers the pushes; that app hands back an
 * endpoint plus a key pair, which the server needs to encrypt to (see `hermes-bot-mobile/webpush.py` in github.com/Madd-Technologies/blobs-hermes-bot-plugins).
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

import type { PushDevice, PushLevel, PushSettings, PushStatus, TestResult } from '../../lib/hermes/push-api.ts'

/** The app's one registration with the push app (the library supports several per phone; we need one). */
export const INSTANCE = 'hermesbot'

export interface Distributor {
  id: string
  name?: string
  /** Built into the library (Firebase). Not what we want: pushes would go through Google. */
  isInternal?: boolean
}

export type PushEvent =
  | { action: 'registered'; data: { url: string; pubKey?: string | null; auth?: string | null; instance: string } }
  | { action: 'registrationFailed'; data: { reason: string; instance: string } }
  | { action: 'unregistered'; data: { instance: string } }
  | { action: 'message'; data: { instance: string } }
  | { action: 'error'; data: { message: string } }

/** The phone's push library. */
export interface NativePush {
  getDistributors(): Distributor[]
  getSavedDistributor(): string | null
  saveDistributor(id: string | null): void
  /** `vapid` is the server's key: the library throws on a missing or malformed one. */
  register(instance: string, vapid: string): Promise<void>
  unregister(instance: string): void
  requestPermissions(): Promise<string>
  subscribe(listener: (event: PushEvent) => void): () => void
}

export interface PushServer {
  status(): Promise<PushStatus | null>
  add(device: { endpoint: string; p256dh: string; auth: string; name: string }): Promise<PushDevice>
  remove(id: string): Promise<unknown>
  setLevels(change: { default?: PushLevel; bots?: Record<string, PushLevel | null> }): Promise<PushSettings>
  test(id: string): Promise<TestResult[]>
}

export type PushPhase =
  /** iPhone, or a build without the push module (Expo Go). */
  | { kind: 'unsupported' }
  | { kind: 'loading' }
  /** The server has neither hermes-bot-mobile nor the older hermes-push. */
  | { kind: 'no-plugin' }
  /** No push app (ntfy, ...) is installed on the phone. */
  | { kind: 'no-distributor' }
  | { kind: 'choose-distributor'; options: Distributor[] }
  | { kind: 'off' }
  | { kind: 'working'; what: string }
  | { kind: 'on' }
  /** Android's notification permission was refused. */
  | { kind: 'blocked' }
  | { kind: 'error'; message: string }

export interface PushState {
  phase: PushPhase
  devices: PushDevice[]
  settings: PushSettings
  /** The server's id for this phone, once registered. */
  mine: string | null
  /** The server's VAPID key, which registering needs. */
  vapid: string | null
  /** The outcome of the last test push. */
  test: { ok: boolean; message: string } | null
}

export interface PushDeps {
  /** Null where there is no push library (iOS, Expo Go). */
  native: NativePush | null
  server: PushServer
  deviceName: () => string
  /** The id the server gave this phone, kept across launches. */
  loadMine: () => Promise<string | null>
  saveMine: (id: string | null) => Promise<void>
  registrationTimeoutMs?: number
}

const NO_SETTINGS: PushSettings = { default: 'all', bots: {} }

/** What a failed registration means, in words for the person. */
export function registrationFailure(reason: string): string {
  switch (reason) {
    case 'NETWORK':
      return 'Your push app could not reach its server. Check its address and your connection.'
    case 'ACTION_REQUIRED':
      return 'Your push app needs something from you first. Open it, then try again.'
    case 'VAPID_REQUIRED':
      return 'Your push app needs an application key, which this version does not send.'
    default:
      return 'Your push app refused the registration.'
  }
}

export function createPushSetup(deps: PushDeps) {
  const timeoutMs = deps.registrationTimeoutMs ?? 20_000
  const store: StoreApi<PushState> = createStore<PushState>(() => ({
    phase: deps.native ? { kind: 'loading' } : { kind: 'unsupported' },
    devices: [],
    settings: NO_SETTINGS,
    mine: null,
    vapid: null,
    test: null,
  }))
  const set = (partial: Partial<PushState>) => store.setState(partial)
  /** An enrolment is waiting for the push app to answer; the standing listener leaves its events alone. */
  let enrolling = false
  let stopListening: (() => void) | null = null

  function fail(error: unknown) {
    set({ phase: { kind: 'error', message: error instanceof Error ? error.message : String(error) } })
  }

  /** Reads the server and works out whether this phone is on. */
  async function refresh() {
    if (!deps.native) {
      return
    }

    try {
      const status = await deps.server.status()

      if (!status) {
        set({ phase: { kind: 'no-plugin' }, devices: [], settings: NO_SETTINGS, mine: null, vapid: null })

        return
      }

      const saved = await deps.loadMine()
      const mine = saved && status.devices.some(device => device.id === saved) ? saved : null

      if (saved && !mine) {
        await deps.saveMine(null)
      }

      set({ devices: status.devices, settings: status.settings, mine, vapid: status.vapid ?? null, phase: mine ? { kind: 'on' } : { kind: 'off' } })
    } catch (error) {
      fail(error)
    }
  }

  /** Keeps the registration alive after launch and re-sends the endpoint if the push app moves it. */
  function start() {
    if (!deps.native || stopListening) {
      return
    }

    const native = deps.native
    stopListening = native.subscribe(event => {
      if (enrolling) {
        return
      }

      const { mine } = store.getState()

      if (event.action === 'registered' && mine && event.data.pubKey && event.data.auth) {
        void deps.server
          .add({ endpoint: event.data.url, p256dh: event.data.pubKey, auth: event.data.auth, name: deps.deviceName() })
          .catch(() => {})
      }

      if (event.action === 'unregistered' && mine) {
        set({ phase: { kind: 'error', message: 'Your push app stopped delivering to this phone. Turn notifications on again.' } })
      }
    })

    // Registering again is how the library checks the connection to the push app, so do it on every launch.
    const { mine, vapid } = store.getState()

    if (mine && vapid) {
      void native.register(INSTANCE, vapid).catch(() => {})
    }
  }

  function stop() {
    stopListening?.()
    stopListening = null
  }

  /** Waits for the push app to answer a registration. Subscribed before asking, so a fast answer is not missed. */
  function answer(native: NativePush) {
    let cancel = () => {}
    const promise = new Promise<Extract<PushEvent, { action: 'registered' }>['data']>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error('Your push app did not answer. Open it and check that it is connected, then try again.'))
      }, timeoutMs)
      const off = native.subscribe(event => {
        if (event.action === 'registered' && event.data.instance === INSTANCE) {
          clearTimeout(timer)
          off()
          resolve(event.data)
        } else if (event.action === 'registrationFailed' && event.data.instance === INSTANCE) {
          clearTimeout(timer)
          off()
          reject(new Error(registrationFailure(event.data.reason)))
        }
      })
      cancel = () => {
        clearTimeout(timer)
        off()
      }
    })

    // A refusal can arrive while `register` is still being awaited; the caller handles it when it gets here.
    promise.catch(() => {})

    return { promise, cancel }
  }

  async function enable(distributorId?: string) {
    const native = deps.native

    if (!native) {
      return
    }

    set({ test: null, phase: { kind: 'working', what: 'Checking your server' } })

    try {
      const status = await deps.server.status()

      if (!status) {
        set({ phase: { kind: 'no-plugin' } })

        return
      }

      if (!status.vapid) {
        throw new Error('The push plugin on your server is out of date. Install the current one, restart Hermes, then try again.')
      }

      const vapid = status.vapid
      set({ phase: { kind: 'working', what: 'Asking for permission' } })

      if ((await native.requestPermissions()) !== 'granted') {
        set({ phase: { kind: 'blocked' } })

        return
      }

      const options = native.getDistributors().filter(distributor => !distributor.isInternal)

      if (options.length === 0) {
        set({ phase: { kind: 'no-distributor' } })

        return
      }

      const saved = native.getSavedDistributor()
      const chosen = distributorId ?? (options.some(option => option.id === saved) ? saved : options.length === 1 ? (options[0]?.id ?? null) : null)

      if (!chosen) {
        set({ phase: { kind: 'choose-distributor', options } })

        return
      }

      native.saveDistributor(chosen)
      set({ phase: { kind: 'working', what: `Connecting to ${options.find(option => option.id === chosen)?.name ?? 'your push app'}` } })
      enrolling = true
      const waiting = answer(native)

      try {
        await native.register(INSTANCE, vapid)
        const registration = await waiting.promise

        if (!registration.pubKey || !registration.auth) {
          throw new Error('Your push app did not return encryption keys, so the server cannot send to it.')
        }

        set({ phase: { kind: 'working', what: 'Telling your server' } })
        const device = await deps.server.add({ endpoint: registration.url, p256dh: registration.pubKey, auth: registration.auth, name: deps.deviceName() })
        await deps.saveMine(device.id)
        enrolling = false
        await refresh()
      } finally {
        waiting.cancel()
        enrolling = false
      }
    } catch (error) {
      fail(error)
    }
  }

  async function disable() {
    const { mine } = store.getState()
    deps.native?.unregister(INSTANCE)

    try {
      if (mine) {
        await deps.server.remove(mine).catch(() => {})
      }

      await deps.saveMine(null)
      await refresh()
    } catch (error) {
      fail(error)
    }
  }

  async function sendTest() {
    const { mine } = store.getState()

    if (!mine) {
      return
    }

    set({ test: null })

    try {
      const [result] = await deps.server.test(mine)

      if (!result) {
        set({ test: { ok: false, message: 'The server did not send anything.' } })
      } else if (result.ok) {
        set({ test: { ok: true, message: 'Sent. It should arrive in a few seconds.' } })
      } else if (result.gone) {
        await deps.saveMine(null)
        await refresh()
        set({ test: { ok: false, message: 'Your push app no longer knows this phone. Turn notifications on again.' } })
      } else {
        set({ test: { ok: false, message: `The push service said no (${result.error ?? 'unknown'}). Check your push app.` } })
      }

      await refresh()
    } catch (error) {
      set({ test: { ok: false, message: error instanceof Error ? error.message : String(error) } })
    }
  }

  /** Sets how loud one bot is; null returns it to the default. */
  async function setLevel(profile: string, level: PushLevel | null) {
    const before = store.getState().settings

    // Show it at once, take it back if the server says no.
    const bots = { ...before.bots }

    if (level === null) {
      delete bots[profile]
    } else {
      bots[profile] = level
    }

    set({ settings: { ...before, bots } })

    try {
      set({ settings: await deps.server.setLevels({ bots: { [profile]: level } }) })
    } catch (error) {
      set({ settings: before })
      fail(error)
    }
  }

  async function setDefault(level: PushLevel) {
    const before = store.getState().settings
    set({ settings: { ...before, default: level } })

    try {
      set({ settings: await deps.server.setLevels({ default: level }) })
    } catch (error) {
      set({ settings: before })
      fail(error)
    }
  }

  return { store, refresh, start, stop, enable, disable, sendTest, setLevel, setDefault }
}

export type PushSetup = ReturnType<typeof createPushSetup>
