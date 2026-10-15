import { create } from 'zustand'

import { describeError } from '@/features/sessions/store'
import { listToolsets, setToolset, type Toolset } from '@/lib/hermes/toolsets'
import { useConnection } from '@/stores/connection'

interface ToolsetsState {
  /** Each bot's toolsets as last read from the server; absent until the first read finishes. */
  byBot: Record<string, { rows: Toolset[]; error: string | null } | undefined>
  load: (profile: string) => Promise<void>
  /** Switches one, showing it at once; if the server refuses, it goes back and the reason is returned. */
  toggle: (profile: string, name: string, enabled: boolean) => Promise<string | null>
}

export const useToolsets = create<ToolsetsState>((set, get) => {
  const patchRow = (profile: string, name: string, enabled: boolean) =>
    set(state => {
      const entry = state.byBot[profile]

      return entry ? { byBot: { ...state.byBot, [profile]: { ...entry, rows: entry.rows.map(row => (row.name === name ? { ...row, enabled } : row)) } } } : state
    })

  return {
    byBot: {},
    load: async profile => {
      const config = useConnection.getState().config

      if (!config) {
        return
      }

      try {
        const rows = await listToolsets(config, profile)

        set(state => ({ byBot: { ...state.byBot, [profile]: { rows, error: null } } }))
      } catch (error) {
        set(state => ({ byBot: { ...state.byBot, [profile]: { rows: state.byBot[profile]?.rows ?? [], error: describeError(error) } } }))
      }
    },
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
})
