import { EnvError, listEnvKeys, type EnvKey } from '@/lib/hermes/env'
import { createBotResourceStore } from '@/stores/botResource'

export const useKeys = createBotResourceStore<{ rows: EnvKey[] | null; error: string | null }>({
  fetch: async (profile, config) => ({ rows: await listEnvKeys(config, profile), error: null }),
  onError: (error, current) => ({
    rows: current?.rows ?? null,
    error: error instanceof EnvError ? error.message : 'Couldn’t read the keys.',
  }),
})
