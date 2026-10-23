import AsyncStorage from '@react-native-async-storage/async-storage'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import { readAsStringAsync } from 'expo-file-system/legacy'

import { createSessions, type BotSession } from '@/features/sessions/store'
import type { Job, Step } from '@/features/transcript/types'
import { supportsLiveHelpers, supportsLiveWork } from '@/lib/hermes/capabilities'
import { gateway, onGatewayEvent, requests, useConnection } from '@/stores/connection'
import { usePrefs } from '@/stores/prefs'
import { useRoster } from '@/stores/roster'

/** The app's chat sessions, wired to the real gateway. */
export const sessions = createSessions({
  client: gateway,
  getConfig: () => useConnection.getState().config,
  getRosterRow: profile => useRoster.getState().rows.find(row => row.name === profile),
  onEvent: onGatewayEvent,
  requests,
  readBase64: uri => readAsStringAsync(uri, { encoding: 'base64' }),
  liveWork: () => supportsLiveWork(useConnection.getState().serverVersion),
  liveHelpers: () => supportsLiveHelpers(useConnection.getState().serverVersion),
  catchUp: liveId => gateway.catchUp(liveId),
  follow: liveId => gateway.follow(liveId),
})

// An earlier version kept which side chat a bot was on under this key; that now lives in the prefs (`lastChats`), and only for
// bots set to open on their last side chat.
void AsyncStorage.removeItem('hermesbot.chats').catch(() => undefined)

/**
 * "Open last side chat" (a bot's Details): for a bot with it on, which side chat it is on is kept in the prefs, so it is where the
 * bot opens next time, after a restart too. Off (the default), a bot always opens on its main chat.
 */
export function startLastChatSync(): () => void {
  const restore = () => {
    const { reopenLast, lastChats } = usePrefs.getState()
    const kept = Object.fromEntries(Object.entries(lastChats).filter(([profile]) => reopenLast[profile]))

    if (Object.keys(kept).length) {
      sessions.store.setState(state => ({ chosen: { ...kept, ...state.chosen } }))
    }
  }

  if (usePrefs.persist.hasHydrated()) {
    restore()
  }

  const stopHydration = usePrefs.persist.onFinishHydration(restore)
  const stopChosen = sessions.store.subscribe((state, previous) => {
    if (state.chosen === previous.chosen) {
      return
    }

    const { reopenLast } = usePrefs.getState()
    const lastChats = Object.fromEntries(Object.entries(state.chosen).filter(([profile]) => reopenLast[profile]))

    if (JSON.stringify(lastChats) !== JSON.stringify(usePrefs.getState().lastChats)) {
      usePrefs.setState({ lastChats })
    }
  })

  return () => {
    stopHydration()
    stopChosen()
  }
}

/** A bot's chat state; undefined until it has been opened. */
export function useBotSession(profile: string): BotSession | undefined {
  return useStore(sessions.store, state => state.bots[profile])
}

/**
 * The jobs (background commands, helpers) these steps started, as the bot's open chat follows them (Hermes 0.22+). Undefined when
 * there are none, so a run without jobs never re-renders for another run's output.
 */
export function useStepJobs(profile: string | undefined, steps: Step[]): Record<string, Job> | undefined {
  const ids = steps.flatMap(step => (step.jobId ? [step.jobId] : []))

  return useStore(
    sessions.store,
    useShallow(state => {
      const jobs = profile && ids.length ? state.bots[profile]?.transcript.jobs : undefined
      const mine = ids.flatMap(id => (jobs?.[id] ? [[id, jobs[id]] as const] : []))

      return mine.length ? Object.fromEntries(mine) : undefined
    }),
  )
}

/** The stored id of the side chat a bot is showing; undefined when it shows its main chat. */
export function useChosenChat(profile: string): string | undefined {
  return useStore(sessions.store, state => state.chosen[profile])
}
