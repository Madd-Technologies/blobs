/** How Settings → Server plugins words one plugin's state. Pure. */

import type { PluginState } from '../../lib/hermes/plugins.ts'

export interface PluginCheck {
  state: PluginState
  /** From the plugin's own route, when it answered. */
  detail?: string
  /** It answers, but something on the server still needs setting up (e.g. Paperless's address and token). */
  needsSetup?: boolean
  /** The older plugin it replaces answered instead (hermes-push for hermes-bot-mobile): the versions are not comparable. */
  formerly?: boolean
}

export interface PluginView {
  /** A word or two on the right of its name. */
  status: string
  /** What it means and what to do, a sentence each. */
  lines: string[]
  /** The message to offer: installing (or finishing setup) or updating; none when there is nothing to paste. */
  action: 'install' | 'update' | null
}

export function pluginView(name: string, check: PluginCheck | undefined, bundled: string, checking: boolean): PluginView {
  if (!check) {
    return { status: checking ? 'Checking…' : '', lines: [], action: null }
  }

  const { state } = check

  switch (state.kind) {
    case 'missing':
      return { status: 'Not installed', lines: ['Paste the setup message to your Hermes bot: it installs the plugin and checks the rest.'], action: 'install' }

    case 'off':
      return { status: 'Turned off', lines: [`Installed but not on. Ask your bot to run “hermes plugins enable ${name}”, then restart Hermes.`], action: null }

    case 'restart':
      return { status: 'Restart Hermes', lines: ['Installed and on. Hermes loads it the next time it starts.'], action: null }

    case 'unknown':
      return { status: 'Couldn’t check', lines: [state.error], action: null }

    case 'ready':
      if (state.update && check.formerly) {
        return { status: 'Update available', lines: check.detail ? [check.detail] : [], action: 'update' }
      }

      if (state.update) {
        return {
          status: 'Update available',
          lines: [...(check.detail ? [check.detail] : []), `Your server has ${state.version ? `version ${state.version}` : 'an older version'}; this app brings ${bundled}.`],
          action: 'update',
        }
      }

      if (check.needsSetup) {
        return { status: 'Needs setup', lines: check.detail ? [check.detail] : [], action: 'install' }
      }

      return { status: 'On', lines: [...(check.detail ? [check.detail] : []), ...(state.version ? [`Version ${state.version}.`] : [])], action: null }
  }
}
