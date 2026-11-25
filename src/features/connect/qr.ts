/**
 * Pure parser for QR code pairing payloads on Connect / Add Server.
 * Accepts `hermesbot://connect?url=...(&token=...&label=...)` or raw `http(s)://...` URLs.
 */

import { normalizeBaseUrl } from '../../lib/hermes/server.ts'

export interface ParsedConnectQr {
  url: string
  token?: string
  label?: string
}

function safeHttpUrl(candidate: string): string | null {
  const trimmed = candidate.trim()

  if (!/^https?:\/\//i.test(trimmed)) {
    return null
  }

  try {
    const parsed = new URL(trimmed)

    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return null
    }

    return normalizeBaseUrl(`${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`)
  } catch {
    return null
  }
}

export function parseConnectQr(raw: string): ParsedConnectQr | null {
  const value = raw.trim()

  if (!value) {
    return null
  }

  if (/^hermesbot:\/\//i.test(value)) {
    try {
      const parsed = new URL(value)

      if (parsed.hostname.toLowerCase() !== 'connect' && parsed.pathname.replace(/^\/+/, '').toLowerCase() !== 'connect') {
        return null
      }

      const target = parsed.searchParams.get('url') ?? ''
      const url = safeHttpUrl(target)

      if (!url) {
        return null
      }

      const token = parsed.searchParams.get('token')?.trim() || undefined
      const label = parsed.searchParams.get('label')?.trim() || undefined

      return { url, ...(token ? { token } : {}), ...(label ? { label } : {}) }
    } catch {
      return null
    }
  }

  const direct = safeHttpUrl(value)

  return direct ? { url: direct } : null
}
