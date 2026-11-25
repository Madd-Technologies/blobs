import { create, type StoreApi, type UseBoundStore } from 'zustand'

import { describeError } from '@/lib/hermes/errors'
import type { ServerConfig } from '@/lib/hermes/server'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

export interface BotResourceBase<Entry> {
  byBot: Record<string, Entry | undefined>
  load: (profile: string) => Promise<void>
  patch: (profile: string, updater: Entry | ((current: Entry | undefined) => Entry | undefined)) => void
  reset: () => void
}

interface ResourceOptions<Entry, Extra extends object> {
  fetch: (profile: string, config: ServerConfig, current: Entry | undefined) => Promise<Entry | undefined>
  onError?: (error: unknown, current: Entry | undefined) => Entry | undefined
  onReset?: () => Partial<Extra> | void
  extra?: (
    set: (partial: Partial<BotResourceBase<Entry> & Extra> | ((state: BotResourceBase<Entry> & Extra) => Partial<BotResourceBase<Entry> & Extra>)) => void,
    get: () => BotResourceBase<Entry> & Extra,
    patch: BotResourceBase<Entry>['patch'],
  ) => Extra
}

/**
 * Factory for per-bot stores keyed by profile (`byBot[profile]`): deduplicates server-switch staleness guards,
 * reset registration, and standardized error fallback across bot settings/resources.
 */
export function createBotResourceStore<Entry, Extra extends object = Record<string, never>>(
  options: ResourceOptions<Entry, Extra>,
): UseBoundStore<StoreApi<BotResourceBase<Entry> & Extra>> {
  let epoch = 0

  const store = create<BotResourceBase<Entry> & Extra>((set, get) => {
    const patch: BotResourceBase<Entry>['patch'] = (profile, updater) => {
      set(state => {
        const current = state.byBot[profile]
        const next = typeof updater === 'function' ? (updater as (c: Entry | undefined) => Entry | undefined)(current) : updater

        if (next === undefined) {
          if (!(profile in state.byBot)) {
            return state
          }

          const { [profile]: _gone, ...rest } = state.byBot

          return { byBot: rest } as Partial<BotResourceBase<Entry> & Extra>
        }

        return { byBot: { ...state.byBot, [profile]: next } } as Partial<BotResourceBase<Entry> & Extra>
      })
    }

    const extra = options.extra ? options.extra(set, get, patch) : ({} as Extra)

    return {
      ...extra,
      byBot: {},
      patch,
      load: async profile => {
        const config = useConnection.getState().config

        if (!config) {
          return
        }

        const myEpoch = epoch
        const baseUrl = config.baseUrl

        try {
          const entry = await options.fetch(profile, config, get().byBot[profile])

          if (myEpoch !== epoch || useConnection.getState().config?.baseUrl !== baseUrl || entry === undefined) {
            return
          }

          patch(profile, entry)
        } catch (error) {
          if (myEpoch !== epoch || useConnection.getState().config?.baseUrl !== baseUrl || !options.onError) {
            return
          }

          const fallback = options.onError(error, get().byBot[profile])

          if (fallback !== undefined) {
            patch(profile, fallback)
          }
        }
      },
      reset: () => {
        epoch++
        const extraReset = options.onReset?.() ?? {}
        set({ byBot: {}, ...extraReset } as Partial<BotResourceBase<Entry> & Extra>)
      },
    }
  })

  registerServerReset(() => store.getState().reset())

  return store
}

export function entryError(error: unknown): string {
  return describeError(error)
}
