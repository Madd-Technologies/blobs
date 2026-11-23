import AsyncStorage from '@react-native-async-storage/async-storage'
import { useStore } from 'zustand'

import { createPushSetup, type PushState } from '@/features/push/setup'
import { addPushDevice, getPushStatus, removePushDevice, sendPushTest, setPushLevels } from '@/lib/hermes/push-api'
import type { ServerConfig } from '@/lib/hermes/server'
import { deviceName, loadNativePush } from '@/lib/unifiedPush'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

const MINE_KEY = 'hermesbot.push.device'

function scopedMineKey(baseUrl?: string | null): string | null {
  const target = baseUrl ?? useConnection.getState().config?.baseUrl

  return target ? `${MINE_KEY}.${encodeURIComponent(target)}` : null
}

function withConfig<T>(run: (config: ServerConfig) => Promise<T>): Promise<T> {
  const config = useConnection.getState().config

  return config ? run(config) : Promise.reject(new Error('Not connected to a server.'))
}

/** Notifications: whether this phone is registered with the server's push plugin (hermes-bot-mobile, or the older hermes-push), and per-bot levels. */
export const push = createPushSetup({
  native: loadNativePush(),
  server: {
    status: () => withConfig(getPushStatus),
    add: device => withConfig(config => addPushDevice(config, device)),
    remove: id => withConfig(config => removePushDevice(config, id)),
    setLevels: change => withConfig(config => setPushLevels(config, change)),
    test: id => withConfig(config => sendPushTest(config, id)),
  },
  deviceName,
  loadMine: async () => {
    const key = scopedMineKey()

    if (!key) {
      return null
    }

    const scoped = await AsyncStorage.getItem(key)

    if (scoped) {
      return scoped
    }

    const legacy = await AsyncStorage.getItem(MINE_KEY)

    if (legacy) {
      await AsyncStorage.setItem(key, legacy).catch(() => undefined)
      await AsyncStorage.removeItem(MINE_KEY).catch(() => undefined)
    }

    return legacy
  },
  saveMine: async id => {
    const key = scopedMineKey()

    if (!key) {
      return
    }

    if (id) {
      await AsyncStorage.setItem(key, id)
    } else {
      await AsyncStorage.removeItem(key)
    }
  },
})

export function usePush<T>(selector: (state: PushState) => T): T {
  return useStore(push.store, selector)
}

/** Reads the server's push state whenever the app is connected, then keeps this phone's registration alive. */
export function startPushSync(): () => void {
  let started = false

  const check = () => {
    if (useConnection.getState().status === 'online') {
      void push.refresh().then(() => {
        if (!started) {
          started = true
          push.start()
        }
      })
    }
  }

  check()
  const stopConnection = useConnection.subscribe((state, previous) => {
    if (state.status === 'online' && previous.status !== 'online') {
      check()
    }
  })

  return () => {
    stopConnection()
    push.stop()
    started = false
  }
}

registerServerReset(() => {
  push.store.setState({ devices: [], settings: { default: 'all', bots: {} }, mine: null, vapid: null, test: null })
})
