import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { getPushFeatures, NO_PUSH, putWatch, type PushFeatures, type WatchSet } from '@/lib/hermes/livepush'
import { useConnection } from '@/stores/connection'

interface LivePushState {
  /** This install's id for the server's watch list (random, kept), so its next update replaces the last one. */
  client: string
  /** What the server pushes; until known (or without the plugins), every store keeps asking on its own timer. */
  features: PushFeatures
}

const newClient = () => `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** What the server pushes over the socket, and this phone's id for telling it what is on screen. */
export const useLivePush = create<LivePushState>()(
  persist((): LivePushState => ({ client: newClient(), features: NO_PUSH }), {
    name: 'blobs.livepush',
    storage: createJSONStorage(() => AsyncStorage),
    partialize: state => ({ client: state.client }),
  }),
)

/** Whether the server pushes this, so the store that would poll for it can ask only rarely. */
export const pushes = (feature: keyof PushFeatures): boolean => useLivePush.getState().features[feature]

type Kind = 'dashboards' | 'records' | 'rooms' | 'errands'

/** What the screens on top show now: per kind, how many screens show each id. */
const shown: Record<Kind, Map<string, number>> = { dashboards: new Map(), records: new Map(), rooms: new Map(), errands: new Map() }
let lastSent = ''
let pending: ReturnType<typeof setTimeout> | null = null

/** Whether a screen on top shows this now (a pushed change to it is loaded at once; others wait until opened). */
export const isShown = (kind: Kind, id: string): boolean => (shown[kind].get(id) ?? 0) > 0

function current(): WatchSet {
  return { dashboards: [...shown.dashboards.keys()].sort(), records: [...shown.records.keys()].sort(), rooms: [...shown.rooms.keys()].sort(), errands: [...shown.errands.keys()].sort() }
}

async function send(force = false, watch: WatchSet = current()) {
  const config = useConnection.getState().config

  if (!config || useConnection.getState().status !== 'online' || !useLivePush.getState().features.watch) {
    return
  }

  const key = JSON.stringify(watch)

  if (key === lastSent && !force) {
    return
  }

  try {
    await putWatch(config, useLivePush.getState().client, watch)
    lastSent = key
  } catch {
    // The next change or the 30 s repeat tries again; until then the server watches what it last heard (for its ttl).
  }
}

function schedule() {
  if (pending) {
    clearTimeout(pending)
  }

  // Screens come and go in pairs (one blurs, the next focuses): one update for both.
  pending = setTimeout(() => {
    pending = null
    void send()
  }, 300)
}

/**
 * Tells the server this screen shows these (while it is focused): it then reads their live panels and streams their rooms'
 * turns, and pushes their changes.
 */
export function useWatch(kind: Kind, ids: readonly (string | null | undefined)[]): void {
  const key = ids.filter((id): id is string => !!id).join('\n')

  useFocusEffect(
    useCallback(() => {
      const list = key ? key.split('\n') : []

      for (const id of list) {
        shown[kind].set(id, (shown[kind].get(id) ?? 0) + 1)
      }

      schedule()

      return () => {
        for (const id of list) {
          const count = (shown[kind].get(id) ?? 1) - 1

          if (count > 0) {
            shown[kind].set(id, count)
          } else {
            shown[kind].delete(id)
          }
        }

        schedule()
      }
    }, [kind, key]),
  )
}

/** Learns what the server pushes when the connection comes up, and keeps the server's watch list current. */
export function startWatchSync(): () => void {
  async function learn() {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    const features = await getPushFeatures(config)

    if (useConnection.getState().config?.baseUrl === config.baseUrl) {
      useLivePush.setState({ features })
      await send(true)
    }
  }

  const stopConnection = useConnection.subscribe((state, previous) => {
    if (state.config?.baseUrl !== previous.config?.baseUrl) {
      useLivePush.setState({ features: NO_PUSH })
      lastSent = ''
    }

    if (state.status === 'online' && previous.status !== 'online') {
      void learn()
    }
  })
  // The server forgets a watch after 90 s unless it is repeated.
  const repeat = setInterval(() => {
    if (AppState.currentState === 'active' && lastSent && lastSent !== JSON.stringify({ dashboards: [], records: [], rooms: [], errands: [] })) {
      void send(true)
    }
  }, 30_000)
  const appState = AppState.addEventListener('change', next => {
    // In the background nothing is on screen: the server can stop watching now rather than when the watch lapses.
    if (next === 'background') {
      void send(true, { dashboards: [], records: [], rooms: [], errands: [] }).then(() => {
        lastSent = ''
      })
    } else if (next === 'active') {
      void send(true)
    }
  })

  if (useConnection.getState().status === 'online') {
    void learn()
  }

  return () => {
    stopConnection()
    clearInterval(repeat)
    appState.remove()
  }
}
