/**
 * Settings → Server plugins' check: each plugin's own route, with Hermes's plugins hub read alongside. Pure apart from the fetches.
 *
 * The probes never wait on the hub. A plugin that answers is shown as soon as it does, and the hub only adds its version (so
 * whether it is due an update). A plugin that doesn't answer waits for the hub, the only thing that tells "not installed" from
 * "installed, not restarted yet"; a hub that is absent, fails or takes longer than `HUB_MS` leaves the two looking the same.
 */

import { pluginHub, pluginState, type HubPlugin } from '../../lib/hermes/plugins.ts'
import type { ServerConfig } from '../../lib/hermes/server.ts'
import { describeError } from '../sessions/store.ts'
import type { PluginCheck } from './view.ts'

/** What a plugin's own route said: how it is doing, whether something is still to set up on the server, and whether the older plugin answered. */
export interface ProbeAnswer {
  detail: string
  needsSetup: boolean
  formerly?: boolean
}

/** What checking one plugin needs. */
export interface Probed {
  name: string
  /** The version the app brings. */
  version: string
  /** An older plugin it replaces, under another name. */
  formerly?: string
  /** Asks the plugin's own route; null when it doesn't answer. */
  probe: (config: ServerConfig) => Promise<ProbeAnswer | null>
}

type Outcome = { answer: ProbeAnswer | null } | { error: unknown }

const versionOf = (hub: HubPlugin[] | null, name: string | undefined) => hub?.find(row => row.name === name)?.version || null

function checkOf(plugin: Probed, outcome: Outcome, hub: HubPlugin[] | null): PluginCheck {
  if ('error' in outcome) {
    return { state: { kind: 'unknown', error: describeError(outcome.error) } }
  }

  const { answer } = outcome
  // Served by the plugin it replaces: working, and due for the move.
  const state = answer?.formerly ? { kind: 'ready' as const, version: versionOf(hub, plugin.formerly), update: true } : pluginState(plugin.name, hub, !!answer, plugin.version)

  return { state, detail: answer?.detail, needsSetup: answer?.needsSetup, formerly: answer?.formerly }
}

/**
 * Every plugin's check, once the probes and the hub are done. `onCheck` hears each row as soon as it is known, before that.
 * `hubMs` is how long the hub may take (`HUB_MS` by default).
 */
export async function checkPlugins(
  config: ServerConfig,
  plugins: Probed[],
  options: { hubMs?: number; onCheck?: (name: string, check: PluginCheck) => void } = {},
): Promise<Record<string, PluginCheck>> {
  // Undefined until the hub is read. It is a nicety: failing to read it, or giving up on it, only loses what it adds.
  let hub: HubPlugin[] | null | undefined
  const hubRead = pluginHub(config, options.hubMs)
    .catch(() => null)
    .then(rows => {
      hub = rows

      return rows
    })
  const outcomes = await Promise.all(
    plugins.map(async (plugin): Promise<[Probed, Outcome]> => {
      const outcome = await plugin.probe(config).then(
        (answer): Outcome => ({ answer }),
        (error: unknown): Outcome => ({ error }),
      )

      // A silent plugin waits for the hub, which says whether it is missing, off or waiting for a restart.
      if (hub !== undefined || !('answer' in outcome) || outcome.answer) {
        options.onCheck?.(plugin.name, checkOf(plugin, outcome, hub ?? null))
      }

      return [plugin, outcome]
    }),
  )
  const rows = await hubRead

  return Object.fromEntries(outcomes.map(([plugin, outcome]) => [plugin.name, checkOf(plugin, outcome, rows)]))
}
