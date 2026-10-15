import { useStore } from 'zustand'

import { createDisplay, type ScreenState } from '@/features/display/store'
import { sha256Hex } from '@/lib/auth-native'
import { gateway, onGatewayEvent, requests, useConnection } from '@/stores/connection'

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
