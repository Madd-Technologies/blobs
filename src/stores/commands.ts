import { create } from 'zustand'

import type { CommandsCatalog } from '@/lib/hermes/protocol'
import { call } from '@/lib/hermes/rpc'
import { slashOptions, type SlashOption } from '@/lib/hermes/slash'
import { gateway } from '@/stores/connection'
import { sessions } from '@/stores/sessions'

export interface BotCommands {
  catalog: CommandsCatalog
  options: SlashOption[]
}

interface CommandsState {
  /** Each bot's slash commands as last read; absent until the first read finishes (or when the server has none to offer). */
  byBot: Record<string, BotCommands | undefined>
  load: (profile: string) => Promise<void>
}

/**
 * What the `/` picker offers in each bot's chat. A bot's skills depend on its profile and workspace, so the server is asked
 * through the bot's own live chat. A server that cannot list them (or a failed read) leaves the box as plain text.
 */
export const useCommands = create<CommandsState>(set => ({
  byBot: {},
  load: async profile => {
    const liveId = sessions.store.getState().bots[profile]?.liveId

    if (!liveId) {
      return
    }

    try {
      const catalog = await call(gateway, 'commands.catalog', { session_id: liveId })

      if (catalog && Array.isArray(catalog.pairs)) {
        set(state => ({ byBot: { ...state.byBot, [profile]: { catalog, options: slashOptions(catalog) } } }))
      }
    } catch {
      // Nothing to offer: typing a slash is just typing.
    }
  },
}))
