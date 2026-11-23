/**
 * Pure normalization and formatting helpers for OS Share Sheet payloads.
 */

export interface SharedFileRef {
  uri: string
  name: string
  mime: string
}

export interface SharedPayload {
  text?: string
  url?: string
  files: SharedFileRef[]
}

export function normalizeSharedPayload(raw: unknown): SharedPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const record = raw as Record<string, unknown>
  const text = typeof record.text === 'string' && record.text.trim() ? record.text.trim() : undefined
  const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : undefined
  const rawFiles = Array.isArray(record.files) ? record.files : []

  const files: SharedFileRef[] = []
  for (const item of rawFiles) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const uri = typeof entry.uri === 'string' ? entry.uri.trim() : ''
    if (!uri) continue
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : uri.split('/').pop() || 'shared-file'
    const mime = typeof entry.mime === 'string' && entry.mime.trim() ? entry.mime.trim() : 'application/octet-stream'
    files.push({ uri, name, mime })
  }

  if (!text && !url && files.length === 0) {
    return null
  }

  return {
    ...(text ? { text } : {}),
    ...(url ? { url } : {}),
    files,
  }
}

export function formatSharedDraft(payload: SharedPayload, note = ''): string {
  const parts: string[] = []
  const trimmedNote = note.trim()
  if (trimmedNote) parts.push(trimmedNote)
  if (payload.text) parts.push(payload.text)
  if (payload.url && payload.url !== payload.text) parts.push(payload.url)

  return parts.join('\n\n')
}
