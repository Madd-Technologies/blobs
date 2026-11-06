/**
 * The digest of a draft you approve (hermes-dashboard 0.6+): SHA-256 over the same canonical JSON the plugin hashes
 * (`approvals.py`), built from exactly what the app draws: the record, the draft's text and format, the fields it covers and
 * its attachment manifest. The app only lets you approve when its digest and the server's agree, and pressing the button
 * sends it, so what you approved is what the bot may send. Pure: the hash function is passed in.
 */

import type { DraftApproval, Field, FileRef, RecordDetail } from '../../lib/hermes/dashboard.ts'

/**
 * JSON with keys sorted at every level and no spaces: Python's `json.dumps(sort_keys=True, separators=(",", ":"),
 * ensure_ascii=False)`. Strings and whole numbers come out byte for byte the same in both.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }

  return JSON.stringify(value)
}

/** The fields a draft's approval covers: its `covers` and the field naming who it is for, sorted. */
export function coveredKeys(field: Field): string[] {
  const keys = [...(field.covers ?? [])]

  if (field.to && !keys.includes(field.to)) {
    keys.push(field.to)
  }

  return keys.sort()
}

/** The document the plugin hashes for one draft of a record. */
export function digestDocument(detail: Pick<RecordDetail, 'record' | 'collection'>, draftKey: string): Record<string, unknown> | null {
  const field = detail.collection.fields.find(candidate => candidate.key === draftKey && candidate.type === 'draft')

  if (!field) {
    return null
  }

  const values = detail.record.values
  const files = field.attachments && Array.isArray(values[field.attachments]) ? (values[field.attachments] as FileRef[]) : []

  return {
    v: 1,
    collection: detail.collection.key,
    record: detail.record.id,
    draft: draftKey,
    format: field.format ?? 'plain',
    text: typeof values[draftKey] === 'string' ? values[draftKey] : '',
    covers: Object.fromEntries(coveredKeys(field).map(key => [key, values[key] ?? null])),
    attachments: files.map(file => ({ name: file.name ?? null, ref: file.path ?? file.url ?? null, mime: file.mime ?? null, size: file.size ?? null, sha256: file.sha256 ?? null })),
  }
}

/** The draft's digest as the app draws it, or null when the record has no such draft. */
export async function draftDigest(detail: Pick<RecordDetail, 'record' | 'collection'>, draftKey: string, sha256Hex: (text: string) => Promise<string>): Promise<string | null> {
  const doc = digestDocument(detail, draftKey)

  return doc ? sha256Hex(canonicalJson(doc)) : null
}

/** A digest the way the card shows it: the first and last four pairs, "3f9a 1c2e … 7b41". */
export function shortDigest(digest: string): string {
  return digest.length < 16 ? digest : `${digest.slice(0, 4)} ${digest.slice(4, 8)} … ${digest.slice(-4)}`
}

/**
 * Where an approval stands, as the draft card says it: waiting for you (the digests agree), it doesn't check out (the app
 * drew something else than the server holds), approved and waiting on the bot, sent exactly what you approved, sent
 * something else, or refused (nothing went out), or approved before the draft changed.
 */
export type ApprovalState =
  | { kind: 'waiting'; digest: string }
  | { kind: 'mismatch' }
  | { kind: 'approved'; digest: string; at: number }
  | { kind: 'sent'; digest: string; at: number }
  | { kind: 'sentOther'; approved: string; sent: string | null; at: number }
  | { kind: 'refused'; digest: string; at: number; detail: string | null }
  | { kind: 'stale'; approved: string; digest: string }

export function approvalState(server: DraftApproval, drawn: string | null): ApprovalState {
  if (!drawn || drawn !== server.digest) {
    return { kind: 'mismatch' }
  }

  const approved = server.approved

  if (!approved) {
    return { kind: 'waiting', digest: server.digest }
  }

  const outcome = approved.outcome

  if (approved.digest !== server.digest) {
    // The draft changed after you approved it: a new version to approve (once the old one was dealt with), or one the bot
    // must not send until you approve it again.
    return outcome ? { kind: 'waiting', digest: server.digest } : { kind: 'stale', approved: approved.digest, digest: server.digest }
  }

  if (outcome?.outcome === 'sent') {
    return outcome.digest === approved.digest ? { kind: 'sent', digest: approved.digest, at: outcome.at } : { kind: 'sentOther', approved: approved.digest, sent: outcome.digest, at: outcome.at }
  }

  if (outcome?.outcome === 'refused') {
    return { kind: 'refused', digest: approved.digest, at: outcome.at, detail: outcome.detail }
  }

  return { kind: 'approved', digest: approved.digest, at: approved.at }
}
