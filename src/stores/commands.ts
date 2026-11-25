import type { CommandsCatalog } from '@/lib/hermes/protocol'
import { call } from '@/lib/hermes/rpc'
import { slashOptions, type SlashOption } from '@/lib/hermes/slash'
import { createBotResourceStore } from '@/stores/botResource'
import { gateway } from '@/stores/connection'
import { sessions } from '@/stores/sessions'

export interface BotCommands {
  catalog: CommandsCatalog
  options: SlashOption[]
}

export const useCommands = createBotResourceStore<BotCommands>({
  fetch: async profile => {
    const liveId = sessions.store.getState().bots[profile]?.liveId

    if (!liveId) {
      return undefined
    }

    const catalog = await call(gateway, 'commands.catalog', { session_id: liveId })

    return catalog && Array.isArray(catalog.pairs) ? { catalog, options: slashOptions(catalog) } : undefined
  },
})
