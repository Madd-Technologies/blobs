import { create } from 'zustand'

import { describeError } from '@/features/sessions/store'
import { getBotVoice, setBotVoice, type BotVoice, type VoiceChange } from '@/lib/hermes/voice'
import { useConnection } from '@/stores/connection'

interface VoiceEntry {
  /** The bot's call settings, or null when the server has no hermes-voice. */
  voice: BotVoice | null
  error: string | null
}

interface VoiceState {
  /** The server these answers came from: another server's settings never apply. */
  server: string | null
  /** Each bot's call settings as last read; absent until the first read finishes. */
  byBot: Record<string, VoiceEntry | undefined>
  load: (profile: string) => Promise<void>
  /** Changes a bot's settings, showing the change at once; if the server refuses, it goes back and the reason is returned. */
  change: (profile: string, change: VoiceChange) => Promise<string | null>
}

export const useVoice = create<VoiceState>((set, get) => {
  /** The connection's config, after forgetting whatever a previous server answered. */
  function current() {
    const config = useConnection.getState().config

    if (config && get().server !== config.baseUrl) {
      set({ server: config.baseUrl, byBot: {} })
    }

    return config
  }

  const put = (profile: string, entry: VoiceEntry) => set(state => ({ byBot: { ...state.byBot, [profile]: entry } }))

  return {
    server: null,
    byBot: {},
    load: async profile => {
      const config = current()

      if (!config) {
        return
      }

      try {
        put(profile, { voice: await getBotVoice(config, profile), error: null })
      } catch (error) {
        put(profile, { voice: get().byBot[profile]?.voice ?? null, error: describeError(error) })
      }
    },
    change: async (profile, change) => {
      const config = current()
      const before = get().byBot[profile]?.voice

      if (!config || !before) {
        return 'Not connected to the server.'
      }

      // Shown at once; readiness follows the account chosen, from what the server last said is there.
      const account = change.account ?? before.account
      put(profile, { voice: { ...before, ...change, ready: account === 'sign-in' ? before.available.sign_in : before.available.key }, error: null })

      try {
        put(profile, { voice: await setBotVoice(config, profile, change), error: null })

        return null
      } catch (error) {
        put(profile, { voice: before, error: null })

        return describeError(error)
      }
    },
  }
})
