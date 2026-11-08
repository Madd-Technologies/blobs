/**
 * Ordering and wording for the bot list. Pure.
 */

import { botLastActive } from '../attention/derive.ts'
import { displayName } from '../../lib/hermes/identity.ts'
import type { ProfileRow } from '../../lib/hermes/protocol.ts'

function meta(row: ProfileRow) {
  return row.ui_meta?.['hermes-bots']
}

export function isPinned(row: ProfileRow): boolean {
  return meta(row)?.pinned === true
}

export function isHidden(row: ProfileRow): boolean {
  return meta(row)?.hidden === true
}

/** Hidden bots are left out; pinned first, then most recent activity, then name. */
export function sortRoster(rows: ProfileRow[], options: { includeHidden?: boolean } = {}): ProfileRow[] {
  return rows
    .filter(row => options.includeHidden || !isHidden(row))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pin = Number(isPinned(b.row)) - Number(isPinned(a.row))

      if (pin) {
        return pin
      }

      const recent = botLastActive(b.row) - botLastActive(a.row)

      if (recent) {
        return recent
      }

      return displayName(a.row, meta(a.row)).localeCompare(displayName(b.row, meta(b.row))) || a.index - b.index
    })
    .map(entry => entry.row)
}

/** Bots whose name matches a search query. Empty query keeps everything. */
export function filterRoster(rows: ProfileRow[], query: string): ProfileRow[] {
  const needle = query.trim().toLowerCase()

  if (!needle) {
    return rows
  }

  return rows.filter(row => {
    const haystack = [row.name, displayName(row, meta(row)), row.description, meta(row)?.description].filter(Boolean).join(' ').toLowerCase()

    return haystack.includes(needle)
  })
}

/** Strips markdown so a one-line preview reads as plain words (ported from Hermes Desktop). */
export function stripPreviewMarkdown(text: string | null | undefined): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The prefix Hermes adds when one bot messages another. */
const A2A_PREFIX = /^Message from (?:agent '([^']+)'|🤖\s*([^:(]+?)(?:\s*\(@[^)]*\))?):\s*/i

export interface Preview {
  text: string
  /** Set when the last message came from another bot, not from the user's chat. */
  fromBot: string | null
}

/** The one-line preview under a bot's name. */
export function previewOf(row: ProfileRow): Preview {
  const raw = row.canonical_session?.preview ?? row.last_session?.preview ?? ''
  const match = A2A_PREFIX.exec(raw.trim())
  const body = match ? raw.trim().slice(match[0].length) : raw

  return { text: stripPreviewMarkdown(body), fromBot: match ? (match[1] ?? match[2] ?? '').trim().toLowerCase() || null : null }
}

/** "now", "3m", "2h", "5d": the compact age shown at the right of a row. */
export function ageLabel(lastActiveS: number, nowS: number): string {
  if (!lastActiveS) {
    return ''
  }

  const diff = Math.max(0, nowS - lastActiveS)

  if (diff < 60) {
    return 'now'
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`
  }

  if (diff < 86_400) {
    return `${Math.floor(diff / 3600)}h`
  }

  if (diff < 7 * 86_400) {
    return `${Math.floor(diff / 86_400)}d`
  }

  return `${Math.floor(diff / (7 * 86_400))}w`
}

/**
 * The new roster with every row that did not change kept as the same object, so a poll that changed one bot re-renders only
 * that bot (its face, its row) instead of every one. Null when nothing changed at all.
 */
export function reuseRows(previous: readonly ProfileRow[], next: readonly ProfileRow[]): ProfileRow[] | null {
  const before = new Map(previous.map(row => [row.name, row]))
  let changed = previous.length !== next.length
  const rows = next.map((row, index) => {
    const old = before.get(row.name)

    if (old && JSON.stringify(old) === JSON.stringify(row)) {
      changed = changed || previous[index] !== old
      return old
    }

    changed = true
    return row
  })

  return changed ? rows : null
}

