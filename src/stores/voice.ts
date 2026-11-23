import { describeError } from '@/lib/hermes/errors'
import { getBotVoice, setBotVoice, type BotVoice, type VoiceChange } from '@/lib/hermes/voice'
import { createBotResourceStore } from '@/stores/botResource'
import { useConnection } from '@/stores/connection'

interface VoiceEntry {
  voice: BotVoice | null
  error: string | null
}

interface VoiceActions {
  change: (profile: string, change: VoiceChange) => Promise<string | null>
}

export const useVoice = createBotResourceStore<VoiceEntry, VoiceActions>({
  fetch: async (profile, config) => ({ voice: await getBotVoice(config, profile), error: null }),
  onError: (error, current) => ({ voice: current?.voice ?? null, error: describeError(error) }),
  extra: (_set, get, patch) => ({
    change: async (profile, change) => {
      const config = useConnection.getState().config
      const before = get().byBot[profile]?.voice

      if (!config || !before) {
        return 'Not connected to the server.'
      }

      const account = change.account ?? before.account
      patch(profile, { voice: { ...before, ...change, ready: account === 'sign-in' ? before.available.sign_in : before.available.key }, error: null })

      try {
        patch(profile, { voice: await setBotVoice(config, profile, change), error: null })

        return null
      } catch (error) {
        patch(profile, { voice: before, error: null })

        return describeError(error)
      }
    },
  }),
})
