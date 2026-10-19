import { create } from 'zustand'

import { EnvError, listEnvKeys, type EnvKey } from '@/lib/hermes/env'
import { useConnection } from '@/stores/connection'

interface KeysState {
  /**
   * Each bot's `.env` names as last read from the server: descriptions and the server's previews, never a value (the app never
   * has one to keep). Absent until the first read finishes.
   */
  byBot: Record<string, { rows: EnvKey[] | null; error: string | null } | undefined>
  load: (profile: string) => Promise<void>
}

export const useKeys = create<KeysState>(set => ({
  byBot: {},
  load: async profile => {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      const rows = await listEnvKeys(config, profile)

      set(state => ({ byBot: { ...state.byBot, [profile]: { rows, error: null } } }))
    } catch (error) {
      const message = error instanceof EnvError ? error.message : 'Couldn’t read the keys.'

      set(state => ({ byBot: { ...state.byBot, [profile]: { rows: state.byBot[profile]?.rows ?? null, error: message } } }))
    }
  },
}))
