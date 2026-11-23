import { describeError } from '@/lib/hermes/errors'
import { listToolsets, setToolset, type Toolset } from '@/lib/hermes/toolsets'
import { createBotResourceStore } from '@/stores/botResource'
import { useConnection } from '@/stores/connection'

interface ToolsetEntry {
  rows: Toolset[]
  error: string | null
}

interface ToolsetActions {
  toggle: (profile: string, name: string, enabled: boolean) => Promise<string | null>
}

export const useToolsets = createBotResourceStore<ToolsetEntry, ToolsetActions>({
  fetch: async (profile, config) => ({ rows: await listToolsets(config, profile), error: null }),
  onError: (error, current) => ({ rows: current?.rows ?? [], error: describeError(error) }),
  extra: (_set, get, patch) => {
    const patchRow = (profile: string, name: string, enabled: boolean) =>
      patch(profile, entry => (entry ? { ...entry, rows: entry.rows.map(row => (row.name === name ? { ...row, enabled } : row)) } : undefined))

    return {
      toggle: async (profile, name, enabled) => {
        const config = useConnection.getState().config
        const before = get().byBot[profile]?.rows.find(row => row.name === name)?.enabled

        if (!config || before === undefined) {
          return 'Not connected to the server.'
        }

        patchRow(profile, name, enabled)

        try {
          await setToolset(config, profile, name, enabled)

          return null
        } catch (error) {
          patchRow(profile, name, before)

          return describeError(error)
        }
      },
    }
  },
})
