import { create } from 'zustand'

import { installMessage, RELEASES, type PluginName } from '@/features/plugins/catalog'
import type { PluginCheck } from '@/features/plugins/view'
import { describeError } from '@/features/sessions/store'
import { getDashboardStatus } from '@/lib/hermes/dashboard'
import { getDriveStatus, getPaperlessStatus, pluginHub, pluginState, type HubPlugin } from '@/lib/hermes/plugins'
import { pushStatusFrom, type PushStatus } from '@/lib/hermes/push-api'
import { getVoiceStatus } from '@/lib/hermes/voice'
import type { ServerConfig } from '@/lib/hermes/server'
import { useConnection } from '@/stores/connection'

/** A Hermes plugin that backs part of the app, with the copy of it the app brings. */
export interface ServerPlugin {
  name: PluginName
  /** What the user calls it. */
  title: string
  /** One line on what it does for them. */
  about: string
  version: string
  setup: string
  /** An older plugin it replaces, under another name (its routes still serve the app until the move). */
  formerly?: string
  /** Nothing in the app needs it: offered on its own, never swept into "one message for all". Updates still are. */
  optional?: boolean
  /**
   * Asks the plugin's own route. Null when it doesn't answer; otherwise one line on how it is doing, whether the user still
   * has something to set up on the server, and whether it was the older plugin that answered.
   */
  probe: (config: ServerConfig) => Promise<{ detail: string; needsSetup: boolean; formerly?: boolean } | null>
}

function phonesLine(status: PushStatus): string {
  const phones = status.devices.length

  return phones ? `${phones} ${phones === 1 ? 'phone gets' : 'phones get'} notifications.` : 'No phone gets notifications yet.'
}

export const SERVER_PLUGINS: ServerPlugin[] = [
  {
    name: 'hermes-bot-mobile',
    title: 'HermesBot',
    about: 'Tells your phone when a bot needs you, and shows what bots in a room are doing.',
    version: RELEASES['hermes-bot-mobile'],
    setup: installMessage(['hermes-bot-mobile']),
    formerly: 'hermes-push',
    probe: async config => {
      const status = await pushStatusFrom(config, 'hermes-bot-mobile')

      if (status) {
        return { detail: phonesLine(status), needsSetup: false }
      }

      const older = await pushStatusFrom(config, 'hermes-push')

      return older ? { detail: `${phonesLine(older)} They come through the older hermes-push plugin, which HermesBot replaces, keeping your phones.`, needsSetup: false, formerly: true } : null
    },
  },
  {
    name: 'hermes-paperless',
    title: 'Paperless',
    about: 'Lets your bots find Paperless-ngx documents and show them in the app’s viewer.',
    version: RELEASES['hermes-paperless'],
    setup: installMessage(['hermes-paperless']),
    probe: async config => {
      const status = await getPaperlessStatus(config)

      if (!status) {
        return null
      }

      return status.configured
        ? { detail: `Connected to Paperless${status.host ? ` at ${status.host}` : ''}.`, needsSetup: false }
        : { detail: 'Not connected to Paperless yet: the server needs its address and a token. The setup message walks your bot through it.', needsSetup: true }
    },
  },
  {
    name: 'hermes-drive',
    title: 'Google Drive',
    about: 'Lets your bots find Drive files, Google Docs and Sheets included, and show them in the app’s viewer.',
    version: RELEASES['hermes-drive'],
    setup: installMessage(['hermes-drive']),
    probe: async config => {
      const status = await getDriveStatus(config)

      if (!status) {
        return null
      }

      if (status.configured && status.drive) {
        return { detail: `Connected to Drive${status.account ? ` as ${status.account}` : ''}.`, needsSetup: false }
      }

      return {
        detail: status.configured
          ? 'The server’s Google sign-in has no Drive access yet. The setup message walks your bot through adding it.'
          : 'Not signed in to Google yet: the server needs the google-workspace skill’s sign-in. The setup message walks your bot through it.',
        needsSetup: true,
      }
    },
  },
  {
    name: 'hermes-dashboard',
    title: 'Dashboards',
    about: 'Optional. Each bot keeps a dashboard of panels for you, opened from its chat: what it found, things to follow up, reminders, a few numbers.',
    version: RELEASES['hermes-dashboard'],
    setup: installMessage(['hermes-dashboard']),
    optional: true,
    probe: async config => {
      const status = await getDashboardStatus(config)

      if (!status) {
        return null
      }

      return {
        detail: status.bots ? `${status.bots} ${status.bots === 1 ? 'bot keeps' : 'bots keep'} a dashboard.` : 'No bot keeps a dashboard yet. Ask one to: “Keep a panel for me with…”.',
        needsSetup: false,
      }
    },
  },
  {
    name: 'hermes-voice',
    title: 'Voice',
    about: 'Optional. Grok voice calls with your bots: you talk, and the bot does the real work in its chat.',
    version: RELEASES['hermes-voice'],
    setup: installMessage(['hermes-voice']),
    optional: true,
    probe: async config => (await getVoiceStatus(config)) ? { detail: 'Ready for calls. Each bot’s Voice settings choose its voice and which xAI account pays.', needsSetup: false } : null,
  },
]

const versionOf = (hub: HubPlugin[] | null, name: string | undefined) => hub?.find(row => row.name === name)?.version || null

interface ServerPluginsState {
  byName: Record<string, PluginCheck | undefined>
  checking: boolean
  check: () => Promise<void>
}

export const useServerPlugins = create<ServerPluginsState>()((set, get) => ({
  byName: {},
  checking: false,
  async check() {
    const config = useConnection.getState().config

    if (!config || get().checking) {
      return
    }

    set({ checking: true })
    // The hub is a nicety (it tells "not installed" from "not restarted yet"); failing to read it only loses that.
    const hub = await pluginHub(config).catch(() => null)
    const checks = await Promise.all(
      SERVER_PLUGINS.map(async (plugin): Promise<[string, PluginCheck]> => {
        try {
          const answer = await plugin.probe(config)
          // Served by the plugin it replaces: working, and due for the move.
          const state = answer?.formerly ? { kind: 'ready' as const, version: versionOf(hub, plugin.formerly), update: true } : pluginState(plugin.name, hub, !!answer, plugin.version)

          return [plugin.name, { state, detail: answer?.detail, needsSetup: answer?.needsSetup, formerly: answer?.formerly }]
        } catch (error) {
          return [plugin.name, { state: { kind: 'unknown', error: describeError(error) } }]
        }
      }),
    )

    set({ byName: Object.fromEntries(checks), checking: false })
  },
}))
