/**
 * Pure multi-server index helpers. Each server's credentials stay in their own SecureStore entry (`hermesbot.server.<id>`)
 * so saving multiple OAuth servers never hits SecureStore's single-item size ceiling; only non-secret metadata lives in the
 * index stored in AsyncStorage.
 */

import { normalizeBaseUrl, type ServerConfig } from './server.ts'

export const SERVER_INDEX_KEY = 'blobs.servers.v1'
export const LEGACY_SERVER_KEY = 'hermesbot.server'

export interface SavedServerMeta {
  id: string
  label: string
  baseUrl: string
  user?: string
  addedAt: number
  lastConnectedAt: number
}

export interface ServerIndex {
  activeId: string | null
  servers: SavedServerMeta[]
}

export const EMPTY_SERVER_INDEX: ServerIndex = { activeId: null, servers: [] }

export function serverKey(id: string): string {
  return `${LEGACY_SERVER_KEY}.${id}`
}

export function defaultServerLabel(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const host = normalized.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')

  return host || normalized
}

export function makeServerId(now = Date.now(), rand = Math.random().toString(36).slice(2, 8)): string {
  return `srv-${now.toString(36)}-${rand}`
}

export function parseServerIndex(raw: string | null): ServerIndex {
  if (!raw) {
    return EMPTY_SERVER_INDEX
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ServerIndex>
    const servers = Array.isArray(parsed.servers)
      ? parsed.servers.filter(
          (entry): entry is SavedServerMeta =>
            !!entry &&
            typeof entry === 'object' &&
            typeof entry.id === 'string' &&
            entry.id.length > 0 &&
            typeof entry.baseUrl === 'string' &&
            entry.baseUrl.length > 0 &&
            typeof entry.label === 'string',
        )
      : []
    const activeId = typeof parsed.activeId === 'string' && servers.some(server => server.id === parsed.activeId) ? parsed.activeId : (servers[0]?.id ?? null)

    return { activeId, servers }
  } catch {
    return EMPTY_SERVER_INDEX
  }
}

export function findServerByUrl(index: ServerIndex, baseUrl: string): SavedServerMeta | undefined {
  const target = normalizeBaseUrl(baseUrl)

  return index.servers.find(server => normalizeBaseUrl(server.baseUrl) === target)
}

export function upsertServerMeta(
  index: ServerIndex,
  config: ServerConfig,
  options: { id?: string; label?: string; now?: number } = {},
): { index: ServerIndex; server: SavedServerMeta } {
  const now = options.now ?? Date.now()
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const existing = (options.id ? index.servers.find(entry => entry.id === options.id) : undefined) ?? findServerByUrl(index, baseUrl)
  const user = config.auth.kind === 'oauth' ? config.auth.user : undefined
  const trimmedLabel = options.label?.trim()

  if (existing) {
    const updated: SavedServerMeta = {
      ...existing,
      baseUrl,
      label: trimmedLabel || existing.label || defaultServerLabel(baseUrl),
      user,
      lastConnectedAt: now,
    }

    return {
      server: updated,
      index: {
        activeId: updated.id,
        servers: index.servers.map(entry => (entry.id === updated.id ? updated : entry)),
      },
    }
  }

  const created: SavedServerMeta = {
    id: options.id || makeServerId(now),
    label: trimmedLabel || defaultServerLabel(baseUrl),
    baseUrl,
    user,
    addedAt: now,
    lastConnectedAt: now,
  }

  return {
    server: created,
    index: {
      activeId: created.id,
      servers: [...index.servers, created],
    },
  }
}

export function renameServerMeta(index: ServerIndex, id: string, label: string): ServerIndex {
  const clean = label.trim()

  if (!clean) {
    return index
  }

  return {
    ...index,
    servers: index.servers.map(server => (server.id === id ? { ...server, label: clean } : server)),
  }
}

export function nextActiveServer(index: ServerIndex, removedId: string): SavedServerMeta | null {
  const remaining = index.servers.filter(server => server.id !== removedId)

  if (remaining.length === 0) {
    return null
  }

  if (index.activeId && index.activeId !== removedId) {
    return remaining.find(server => server.id === index.activeId) ?? remaining[0] ?? null
  }

  return [...remaining].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)[0] ?? null
}

export function removeServerMeta(index: ServerIndex, id: string): ServerIndex {
  const remaining = index.servers.filter(server => server.id !== id)
  const next = nextActiveServer(index, id)

  return {
    activeId: next?.id ?? null,
    servers: remaining,
  }
}
