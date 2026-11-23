import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'

import { iosDeviceName, loadApnsPush } from '@/lib/apnsPush'
import { describeError } from '@/lib/hermes/errors'
import {
  addApnsDevice,
  getPushStatus,
  removePushDevice,
  sendPushTest,
  setPushLevels,
  type PushDevice,
  type PushLevel,
  type PushSettings,
} from '@/lib/hermes/push-api'
import { getApnsStatus } from '@/lib/hermes/station'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

const APNS_MINE_KEY = 'hermesbot.apns.device'
const TOKEN_WAIT_MS = 10_000

function scopedKey(baseUrl?: string | null): string | null {
  const target = baseUrl ?? useConnection.getState().config?.baseUrl
  return target ? `${APNS_MINE_KEY}.${encodeURIComponent(target)}` : null
}

function waitForApnsToken(): Promise<string> {
  const native = loadApnsPush()
  if (!native) {
    return Promise.reject(new Error('iOS push module is unavailable in this build.'))
  }

  const existing = native.getToken()
  if (existing) {
    return Promise.resolve(existing)
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      tokenSub.remove()
      errSub.remove()
      reject(new Error('Timed out waiting for Apple Push token (notifications require a development/App Store build).'))
    }, TOKEN_WAIT_MS)

    const tokenSub = native.addListener('onToken', ev => {
      clearTimeout(timer)
      tokenSub.remove()
      errSub.remove()
      resolve(ev.token)
    })

    const errSub = native.addListener('onError', ev => {
      clearTimeout(timer)
      tokenSub.remove()
      errSub.remove()
      reject(new Error(ev.message || 'Failed to register for Apple Push Notifications.'))
    })
  })
}

interface ApnsState {
  supported: boolean
  loading: boolean
  busy: boolean
  enabled: boolean
  deviceId: string | null
  token: string | null
  devices: PushDevice[]
  settings: PushSettings
  serverConfigured: boolean | null
  testMessage: { ok: boolean; text: string } | null
  error: string | null
  refresh: () => Promise<void>
  enable: () => Promise<string | null>
  disable: () => Promise<string | null>
  setDefault: (level: PushLevel) => Promise<void>
  setLevel: (profile: string, level: PushLevel) => Promise<void>
  sendTest: () => Promise<void>
  reset: () => void
}

const DEFAULT_SETTINGS: PushSettings = { default: 'all', bots: {} }

const EMPTY = {
  supported: !!loadApnsPush(),
  loading: false,
  busy: false,
  enabled: false,
  deviceId: null as string | null,
  token: null as string | null,
  devices: [] as PushDevice[],
  settings: DEFAULT_SETTINGS,
  serverConfigured: null as boolean | null,
  testMessage: null as { ok: boolean; text: string } | null,
  error: null as string | null,
}

export const useApns = create<ApnsState>((set, get) => ({
  ...EMPTY,

  reset: () => set({ ...EMPTY, supported: !!loadApnsPush() }),

  refresh: async () => {
    const cfg = useConnection.getState().config
    if (!cfg) return
    const server = cfg.baseUrl
    const native = loadApnsPush()

    set({ loading: true, error: null, supported: !!native })
    try {
      const [status, apnsStat, savedId] = await Promise.all([
        getPushStatus(cfg),
        getApnsStatus(cfg),
        scopedKey(server) ? AsyncStorage.getItem(scopedKey(server)!) : Promise.resolve(null),
      ])
      if (useConnection.getState().config?.baseUrl !== server) return

      const mine = savedId ? status?.devices.find(d => d.id === savedId) ?? null : null
      set({
        loading: false,
        devices: status?.devices ?? [],
        settings: status?.settings ?? DEFAULT_SETTINGS,
        serverConfigured: apnsStat ? apnsStat.configured : null,
        deviceId: mine ? mine.id : null,
        enabled: !!mine,
        token: native?.getToken() ?? null,
      })
    } catch (error) {
      if (useConnection.getState().config?.baseUrl === server) {
        set({ loading: false, error: describeError(error) })
      }
    }
  },

  enable: async () => {
    const cfg = useConnection.getState().config
    const native = loadApnsPush()
    if (!cfg) return 'Not connected to a server.'
    if (!native) return 'Push notifications require a native iOS build of Blobs.'

    const server = cfg.baseUrl
    set({ busy: true, error: null, testMessage: null })

    try {
      const granted = await native.requestPermissionsAndRegister()
      if (!granted) {
        set({ busy: false, error: 'Notifications are disabled in iOS Settings.' })
        return 'Notifications are disabled in iOS Settings.'
      }

      const token = await waitForApnsToken()
      const env = native.getEnvironment()
      const registered = await addApnsDevice(cfg, {
        apns_token: token,
        apns_env: env,
        name: iosDeviceName(),
      })

      if (useConnection.getState().config?.baseUrl !== server) return null

      const key = scopedKey(server)
      if (key) {
        await AsyncStorage.setItem(key, registered.id)
      }

      set({ busy: false, enabled: true, deviceId: registered.id, token })
      await get().refresh()
      return null
    } catch (error) {
      const msg = describeError(error)
      set({ busy: false, error: msg })
      return msg
    }
  },

  disable: async () => {
    const cfg = useConnection.getState().config
    const id = get().deviceId
    set({ busy: true, error: null, testMessage: null })

    try {
      if (cfg && id) {
        await removePushDevice(cfg, id)
      }
      const key = scopedKey()
      if (key) {
        await AsyncStorage.removeItem(key)
      }
      set({ busy: false, enabled: false, deviceId: null })
      await get().refresh()
      return null
    } catch (error) {
      const msg = describeError(error)
      set({ busy: false, error: msg })
      return msg
    }
  },

  setDefault: async level => {
    const cfg = useConnection.getState().config
    if (!cfg) return
    const next = await setPushLevels(cfg, { default: level })
    set({ settings: next })
  },

  setLevel: async (profile, level) => {
    const cfg = useConnection.getState().config
    if (!cfg) return
    const next = await setPushLevels(cfg, { bots: { [profile]: level } })
    set({ settings: next })
  },

  sendTest: async () => {
    const cfg = useConnection.getState().config
    const id = get().deviceId
    if (!cfg || !id) return

    try {
      const results = await sendPushTest(cfg, id)
      const hit = results.find(r => r.device === id) ?? results[0]
      if (!hit) {
        set({ testMessage: { ok: false, text: 'No registered iOS device responded.' } })
        return
      }
      set({
        testMessage: hit.ok
          ? { ok: true, text: 'Test notification sent via APNs.' }
          : { ok: false, text: hit.error || 'APNs delivery failed.' },
      })
    } catch (error) {
      set({ testMessage: { ok: false, text: describeError(error) } })
    }
  },
}))

registerServerReset(() => useApns.getState().reset())
