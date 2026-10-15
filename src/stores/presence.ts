import { useEffect } from 'react'
import { AppState } from 'react-native'
import { create } from 'zustand'

import { createPresence } from '@/features/push/presence'
import { setPushPresence } from '@/lib/hermes/push-api'
import { useConnection } from '@/stores/connection'
import { push } from '@/stores/push'

/** The session ids of the chat or room on screen right now. */
const useOnScreenStore = create<{ sessions: string[] }>(() => ({ sessions: [] }))

/** A chat or room screen says which sessions it shows while it is open, so the server does not push them. */
export function useOnScreen(sessions: string[]): void {
  const key = sessions.join('|')

  useEffect(() => {
    useOnScreenStore.setState({ sessions: key ? key.split('|') : [] })

    return () => useOnScreenStore.setState({ sessions: [] })
  }, [key])
}

/** Keeps the server's push plugin (hermes-bot-mobile, or the older hermes-push) told whether this phone is in front and what it shows. */
export function startPresenceSync(): () => void {
  const presence = createPresence({
    send: body => {
      const config = useConnection.getState().config

      return config ? setPushPresence(config, body) : Promise.resolve()
    },
  })
  const read = () => ({
    device: push.store.getState().mine,
    online: useConnection.getState().status === 'online',
    foreground: AppState.currentState === 'active',
    sessions: useOnScreenStore.getState().sessions,
  })

  presence.update(read())
  const stops = [
    push.store.subscribe(() => presence.update(read())),
    useConnection.subscribe(() => presence.update(read())),
    useOnScreenStore.subscribe(() => presence.update(read())),
  ]
  const appState = AppState.addEventListener('change', () => presence.update(read()))

  return () => {
    stops.forEach(stop => stop())
    appState.remove()
    presence.stop()
  }
}
