/**
 * A bot's toolsets: groups of tools (web search, the terminal, browser, image generation…) it can be given or denied. The dashboard's
 * profile-scoped REST routes: reading lists them, switching one writes that bot's own config, and the change reaches the bot on its next
 * message. Pure: no React Native imports.
 */

import { restJson, type ServerConfig } from './server.ts'

export interface Toolset {
  /** What the server calls it (`web`, `terminal`…): what is sent to switch it. */
  name: string
  label: string
  description: string
  /** The platform whose settings it lives in (`cli` for most); a toolset only for a messaging platform names it. */
  platform: string
  platformLabel: string
  enabled: boolean
  /** Whether what it needs (an API key, a login) is in place. */
  configured: boolean
  toolCount: number
}

interface Raw {
  name?: unknown
  label?: unknown
  description?: unknown
  platform?: unknown
  platform_label?: unknown
  enabled?: unknown
  configured?: unknown
  tools?: unknown
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

/** `profile` is always sent: without it the server would answer for its own default profile. */
const path = (profile: string, name = '') => `/api/tools/toolsets${name ? `/${encodeURIComponent(name)}` : ''}?profile=${encodeURIComponent(profile)}`

export async function listToolsets(config: ServerConfig, profile: string): Promise<Toolset[]> {
  const rows = await restJson<Raw[]>(config, path(profile))

  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const name = text(row.name)

    return name
      ? [
          {
            name,
            label: text(row.label, name),
            description: text(row.description),
            platform: text(row.platform, 'cli'),
            platformLabel: text(row.platform_label),
            enabled: row.enabled === true,
            // Older servers do not say: not knowing is not a reason to warn.
            configured: row.configured !== false,
            toolCount: Array.isArray(row.tools) ? row.tools.length : 0,
          } satisfies Toolset,
        ]
      : []
  })
}

/** Switches one of this bot's toolsets. The server answers `{ ok: true }`; anything else it says is an error. */
export async function setToolset(config: ServerConfig, profile: string, name: string, enabled: boolean): Promise<void> {
  await restJson(config, path(profile, name), { method: 'PUT', body: JSON.stringify({ enabled, profile }) })
}

/** "5 of 9 on", for the Details row. */
export const toolsetsLine = (rows: readonly Toolset[]) => (rows.length ? `${rows.filter(row => row.enabled).length} of ${rows.length} on` : '')

/** One line under a toolset's name: what it is for, how many tools it holds, and where it lives when that is not the main chat. */
export function toolsetDetail(row: Toolset): string {
  const parts = [row.description.replace(/\s+/g, ' ').trim(), row.toolCount ? `${row.toolCount} ${row.toolCount === 1 ? 'tool' : 'tools'}` : '', row.platform !== 'cli' && row.platformLabel ? `for ${row.platformLabel}` : ''].filter(Boolean)

  return parts.join(' · ')
}
