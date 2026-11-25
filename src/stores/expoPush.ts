import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { create } from 'zustand'

import { configureExpoNotifications, expoDeviceName, isExpoPushSupported, registerForExpoPushToken } from '@/lib/expoPush'
import { describeError } from '@/lib/hermes/errors'
import {
  addExpoPushDevice,
  getPushStatus,
  removePushDevice,
  sendPushTest,
  setPushLevels,
  type PushDevice,
  type PushLevel,
  type PushSettings,
} from '@/lib/hermes/push-api'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

const EXPO_MINE_KEY = 'hermesbot.expopush.device'
const EXPO_MINIMAL_KEY = 'hermesbot.expopush.minimal'

function scopedKey(prefix: string, baseUrl?: string | null): string | null {
  const target = baseUrl ?? useConnection.getState().config?.baseUrl
  return target ? `${prefix}.${encodeURIComponent(target)}` : null
}

interface ExpoPushState {
  supported: boolean
  loading: boolean
  busy: boolean
  enabled: boolean
  deviceId: string | null
  token: string | null
  minimal: boolean
  devices: PushDevice[]
  settings: PushSettings
  serverHasPlugin: boolean | null
  serverSupportsExpo: boolean | null
  testMessage: { ok: boolean; text: string } | null
  error: string | null
  refresh: () => Promise<void>
  enable: () => Promise<string | null>
  disable: () => Promise<string | null>
  setMinimal: (next: boolean) => Promise<string | null>
  setDefault: (level: PushLevel) => Promise<void>
  setLevel: (profile: string, level: PushLevel) => Promise<void>
  sendTest: () => Promise<void>
  reset: () => void
}

const DEFAULT_SETTINGS: PushSettings = { default: 'all', bots: {} }

const EMPTY = {
  supported: isExpoPushSupported(),
  loading: false,
  busy: false,
  enabled: false,
  deviceId: null as string | null,
  token: null as string | null,
  minimal: false,
  devices: [] as PushDevice[],
  settings: DEFAULT_SETTINGS,
  serverHasPlugin: null as boolean | null,
  serverSupportsExpo: null as boolean | null,
  testMessage: null as { ok: boolean; text: string } | null,
  error: null as string | null,
}

export const useExpoPush = create<ExpoPushState>((set, get) => ({
  ...EMPTY,

  reset: () => set({ ...EMPTY, supported: isExpoPushSupported() }),

  refresh: async () => {
    const cfg = useConnection.getState().config
    if (!cfg) return
    const server = cfg.baseUrl
    const supported = isExpoPushSupported()

    set({ loading: true, error: null, supported })
    try {
      const [status, savedId, savedMinimal] = await Promise.all([
        getPushStatus(cfg),
        scopedKey(EXPO_MINE_KEY, server) ? AsyncStorage.getItem(scopedKey(EXPO_MINE_KEY, server)!) : Promise.resolve(null),
        scopedKey(EXPO_MINIMAL_KEY, server) ? AsyncStorage.getItem(scopedKey(EXPO_MINIMAL_KEY, server)!) : Promise.resolve(null),
      ])
      if (useConnection.getState().config?.baseUrl !== server) return

      const mine = savedId ? status?.devices.find(d => d.id === savedId) ?? null : null
      const minimal = mine?.minimal ?? savedMinimal === '1'
      set({
        loading: false,
        devices: status?.devices ?? [],
        settings: status?.settings ?? DEFAULT_SETTINGS,
        serverHasPlugin: status !== null,
        serverSupportsExpo: status ? Boolean(status.features?.includes('expo_push')) : null,
        deviceId: mine ? mine.id : null,
        enabled: !!mine,
        minimal,
      })

      if (mine) {
        void configureExpoNotifications()
      }
    } catch (error) {
      if (useConnection.getState().config?.baseUrl === server) {
        set({ loading: false, error: describeError(error) })
      }
    }
  },

  enable: async () => {
    const cfg = useConnection.getState().config
    if (!cfg) return 'Not connected to a server.'
    if (!isExpoPushSupported()) return 'Push notifications require a native iOS or Android build.'

    const server = cfg.baseUrl
    set({ busy: true, error: null, testMessage: null })

    try {
      const status = await getPushStatus(cfg)
      if (!status) {
        const msg = 'Install the hermes-bot-mobile plugin on your server first.'
        set({ busy: false, serverHasPlugin: false, serverSupportsExpo: null, error: msg })
        return msg
      }
      if (!status.features?.includes('expo_push')) {
        const msg = 'Update hermes-bot-mobile to 0.5.0+ on your server to enable Expo Push notifications.'
        set({ busy: false, serverHasPlugin: true, serverSupportsExpo: false, error: msg })
        return msg
      }

      const tokenRes = await registerForExpoPushToken()
      if (!tokenRes.ok) {
        set({ busy: false, error: tokenRes.error })
        return tokenRes.error
      }

      const registered = await addExpoPushDevice(cfg, {
        expo_token: tokenRes.token,
        name: expoDeviceName(),
        minimal: get().minimal,
        device_os: Platform.OS,
      })
      if (useConnection.getState().config?.baseUrl !== server) return null

      const key = scopedKey(EXPO_MINE_KEY, server)
      if (key) {
        await AsyncStorage.setItem(key, registered.id)
      }

      set({
        busy: false,
        enabled: true,
        deviceId: registered.id,
        token: tokenRes.token,
        serverHasPlugin: true,
        serverSupportsExpo: true,
        error: null,
      })
      await get().refresh()
      return null
    } catch (error) {
      const msg = describeError(error)
      if (useConnection.getState().config?.baseUrl === server) {
        set({ busy: false, error: msg })
      }
      return msg
    }
  },

  disable: async () => {
    const cfg = useConnection.getState().config
    const id = get().deviceId
    set({ busy: true, error: null, testMessage: null })
    try {
      if (cfg && id) {
        await removePushDevice(cfg, id).catch(() => undefined)
      }
      const key = scopedKey(EXPO_MINE_KEY, cfg?.baseUrl)
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

  setMinimal: async next => {
    const cfg = useConnection.getState().config
    const minKey = scopedKey(EXPO_MINIMAL_KEY, cfg?.baseUrl)
    set({ minimal: next, error: null })
    if (minKey) {
      await AsyncStorage.setItem(minKey, next ? '1' : '0').catch(() => undefined)
    }

    if (!cfg || !get().enabled) {
      return null
    }

    let token = get().token
    if (!token) {
      const res = await registerForExpoPushToken()
      if (!res.ok) {
        set({ error: res.error })
        return res.error
      }
      token = res.token
    }

    try {
      const registered = await addExpoPushDevice(cfg, {
        expo_token: token,
        name: expoDeviceName(),
        minimal: next,
        device_os: Platform.OS,
      })
      const idKey = scopedKey(EXPO_MINE_KEY, cfg.baseUrl)
      if (idKey) {
        await AsyncStorage.setItem(idKey, registered.id).catch(() => undefined)
      }
      set({ deviceId: registered.id, token })
      await get().refresh()
      return null
    } catch (error) {
      const msg = describeError(error)
      set({ error: msg })
      return msg
    }
  },

  setDefault: async level => {
    const cfg = useConnection.getState().config
    if (!cfg) return
    try {
      const next = await setPushLevels(cfg, { default: level })
      set({ settings: next })
    } catch (error) {
      set({ error: describeError(error) })
    }
  },

  setLevel: async (profile, level) => {
    const cfg = useConnection.getState().config
    if (!cfg) return
    try {
      const next = await setPushLevels(cfg, { bots: { [profile]: level } })
      set({ settings: next })
    } catch (error) {
      set({ error: describeError(error) })
    }
  },

  sendTest: async () => {
    const cfg = useConnection.getState().config
    const id = get().deviceId
    if (!cfg || !id) return
    set({ testMessage: null })
    try {
      const results = await sendPushTest(cfg, id)
      const hit = results.find(r => r.device === id) ?? results[0]
      if (!hit) {
        set({ testMessage: { ok: false, text: 'No response from server.' } })
        return
      }
      set({
        testMessage: hit.ok
          ? { ok: true, text: 'Sent. A notification should appear on your device.' }
          : { ok: false, text: hit.error || `Failed (${hit.status ?? 'error'})` },
      })
      await get().refresh()
    } catch (error) {
      set({ testMessage: { ok: false, text: describeError(error) } })
    }
  },
}))

export function startExpoPushSync(): () => void {
  const check = () => {
    if (useConnection.getState().status === 'online') {
      void useExpoPush.getState().refresh()
    }
  }
  check()
  const stopConnection = useConnection.subscribe((state, previous) => {
    if (state.status === 'online' && previous.status !== 'online') {
      check()
    }
  })
  return () => stopConnection()
}

registerServerReset(() => useExpoPush.getState().reset())
