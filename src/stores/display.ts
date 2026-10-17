import { useEffect } from 'react'
import { useStore } from 'zustand'

import { createDisplay, type ScreenState } from '@/features/display/store'
import { sha256Hex } from '@/lib/auth-native'
import { gateway, onGatewayEvent, requests, useConnection } from '@/stores/connection'
import { useBrowserMode } from '@/stores/profiles'

/** Every bot's Bot Screen, wired to the real gateway. */
export const display = createDisplay({
  client: gateway,
  onEvent: onGatewayEvent,
  getGeneration: () => useConnection.getState().generation,
  sha256Hex,
  requests,
})

/** A bot's screen state; undefined until it has been read. */
export function useScreen(profile: string): ScreenState | undefined {
  return useStore(display.store, state => state.screens[profile])
}

const browserAsked = new Map<string, number>()
/** How long one bot's answer stands before a chat row asks again. */
const BROWSER_ASK_EVERY_MS = 5 * 60_000

/**
 * Whether this bot's browser shows on its Bot Screen, so its browser steps can be watched there: `browser.headed` is on, or the
 * screen is running (Hermes then uses a Chrome already open on it). Asked once in a while for each bot whose chat is on screen.
 */
export function useBrowserShows(profile: string): boolean {
  const headed = useBrowserMode(state => state.byBot[profile] === true)
  const running = useStore(display.store, state => state.screens[profile]?.status?.running === true)

  useEffect(() => {
    const now = Date.now()

    if (now - (browserAsked.get(profile) ?? 0) < BROWSER_ASK_EVERY_MS) {
      return
    }

    browserAsked.set(profile, now)
    void useBrowserMode.getState().load(profile)
    void display.refresh(profile)
  }, [profile])

  return headed || running
}
