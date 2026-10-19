/**
 * A bot's keys: what is in its own `.env` on the server (API keys for its tools and model providers). These are Hermes's own
 * dashboard routes, the ones its web Keys page uses (`hermes_cli/web_routers/config_env.py`, the same from 0.21.0 to 0.22.2), so a
 * key goes straight into the file with no model in the loop:
 *
 * - `GET /api/env?profile=` lists every name Hermes knows plus whatever else the `.env` holds (`custom`), each with a preview of
 *   the value (`«redacted:sk-a...wxyz»`, a bare `sk-a...wxyz` before 0.21.5), never the value itself.
 * - `PUT /api/env` `{key, value, profile}` saves one, and also moves config mirrors of the old value and Hermes's credential pool
 *   over to it. 400 for a preview sent back as a value (0.21.5+), a denylisted name (PATH, LD_PRELOAD…) or a name an administrator
 *   pinned.
 * - `DELETE /api/env` `{key, profile}` removes it everywhere; 404 when it was not there.
 *
 * `POST /api/env/reveal` hands back a real value: the app never calls it. A value passes through here once, in a PUT's body, and no
 * error this module throws carries it, or anything the server echoed back (a 422 repeats the whole body). Pure: no React Native
 * imports.
 */

import { fetchWithin, restHeaders, type ServerConfig } from './server.ts'

export interface EnvKey {
  /** The variable's name in the `.env`. */
  name: string
  isSet: boolean
  /** What the server shows in place of the value (`sk-a...wxyz`), or null when it is not set. */
  preview: string | null
  description: string
  /** Where to get one (the provider's console), when the server knows. Only http(s). */
  url: string | null
  /** `provider`, `tool`, `skill`, `setting`, `messaging`, `custom`… */
  category: string
  /** The server treats it as a secret (rather than a setting such as a base URL). Every `custom` one counts as a secret. */
  secret: boolean
  /** A messaging platform's credential: Hermes manages those on its Channels page, so the Keys screen leaves them out. */
  channel: boolean
  /** In the `.env` but in none of Hermes's lists. */
  custom: boolean
  /** The model provider it belongs to ("xAI"), or ''. */
  provider: string
}

interface RawRow {
  is_set?: unknown
  redacted_value?: unknown
  description?: unknown
  url?: unknown
  category?: unknown
  is_password?: unknown
  channel_managed?: unknown
  custom?: unknown
  provider_label?: unknown
}

/** What the server accepts as a name (`_ENV_VAR_NAME_RE`). */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export const isEnvName = (name: string): boolean => NAME.test(name)

/** How long a read or a save may take before it counts as failed. */
const REQUEST_MS = 20_000

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The server's preview without its «redacted:…» wrapper; older servers send the bare mask. */
export function previewOf(raw: unknown): string | null {
  const value = text(raw).trim()
  const wrapped = /^«redacted:([\s\S]*)»$/.exec(value)

  return (wrapped ? (wrapped[1] ?? '').trim() : value) || null
}

/**
 * Whether a value is one of Hermes's previews rather than a key (`is_redacted_credential_preview`): pasting one back would overwrite
 * the real key with its own mask, and servers before 0.21.5 would save it.
 */
export const looksRedacted = (value: string): boolean => value.startsWith('«redacted') || value === '***' || /^.{4}\.\.\..{4}$/.test(value)

function parseRow(name: string, row: RawRow): EnvKey {
  const url = text(row.url).trim()
  const custom = row.custom === true

  return {
    name,
    isSet: row.is_set === true,
    preview: row.is_set === true ? previewOf(row.redacted_value) : null,
    description: text(row.description).replace(/\s+/g, ' ').trim(),
    url: /^https?:\/\//i.test(url) ? url : null,
    category: text(row.category),
    secret: row.is_password === true || custom,
    channel: row.channel_managed === true,
    custom,
    provider: text(row.provider_label),
  }
}

/** Why a request failed, in words to show. Never the value, never the server's echo of it. */
export class EnvError extends Error {
  /** The HTTP status, or null when the server never answered (or the app refused before sending). */
  readonly status: number | null
  /** A DELETE's 404 for a key the `.env` does not have (not an unknown bot, which is also a 404). */
  readonly missingKey: boolean

  constructor(status: number | null, message: string, missingKey = false) {
    super(message)
    this.name = 'EnvError'
    this.status = status
    this.missingKey = missingKey
  }
}

/** The first sentence of a refusal: Hermes's denylist answer goes on to explain itself for three more. */
function firstSentence(detail: string): string {
  const end = detail.search(/\.\s/)

  return end > 0 ? detail.slice(0, end + 1) : detail
}

/**
 * Words for a failed request. A string `detail` (FastAPI's `HTTPException`) is the server's own reason and is shown, unless it
 * repeats the value; a list `detail` (a 422) echoes the request body, value included, and is never read.
 */
function refusal(status: number, detail: string, value: string | undefined): string {
  const safe = detail && !(value && detail.includes(value)) ? firstSentence(detail.trim()) : ''

  if (status === 401) {
    return 'The server signed this app out. Sign in again.'
  }

  if (status === 403) {
    return safe || 'The server doesn’t allow this sign-in to change keys.'
  }

  if (status === 404) {
    return /^Profile .* does not exist/.test(safe) ? 'The server has no bot by this name.' : safe || 'The server has no keys page. Update Hermes.'
  }

  if (status === 400 && safe) {
    return safe
  }

  if (status === 422) {
    return 'The server didn’t understand that request.'
  }

  return status >= 500 ? 'The server ran into an error. Try again.' : `The server refused (${status}).`
}

async function detailOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown } | null

    return typeof body?.detail === 'string' ? body.detail : ''
  } catch {
    return ''
  }
}

/** One call to `/api/env` for one bot: `profile` goes in the query and (for writes) the body, as Hermes's own dashboard sends it. */
async function request<T>(config: ServerConfig, method: 'GET' | 'PUT' | 'DELETE', profile: string, body?: { key: string; value?: string; profile: string }): Promise<T> {
  let res: Response

  try {
    res = await fetchWithin(
      `${config.baseUrl}/api/env?profile=${encodeURIComponent(profile)}`,
      {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...restHeaders(config) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      REQUEST_MS,
    )
  } catch (error) {
    // fetch's own failures (offline, the timeout) say nothing about what was sent; keep only the timeout's words.
    throw new EnvError(null, error instanceof Error && error.message.startsWith('No answer') ? error.message : 'Couldn’t reach the server.')
  }

  if (!res.ok) {
    const detail = await detailOf(res)

    throw new EnvError(res.status, refusal(res.status, detail, body?.value), method === 'DELETE' && res.status === 404 && /not found in \.env$/.test(detail))
  }

  try {
    return (await res.json()) as T
  } catch {
    throw new EnvError(res.status, 'The server’s answer wasn’t readable.')
  }
}

/** Every name the server knows for this bot, set or not, plus whatever else its `.env` holds. */
export async function listEnvKeys(config: ServerConfig, profile: string): Promise<EnvKey[]> {
  const raw = await request<Record<string, RawRow> | null>(config, 'GET', profile)

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return []
  }

  return Object.entries(raw).flatMap(([name, row]) => (isEnvName(name) && row && typeof row === 'object' ? [parseRow(name, row)] : []))
}

/**
 * What a typed or pasted value becomes before it is sent: trimmed (a paste often brings a newline), or why it can't be. Hermes would
 * strip a non-ASCII character without saying so (lookalike glyphs from a PDF), saving a key that no longer works.
 */
export function cleanValue(raw: string): { value: string } | { error: string } {
  const value = raw.trim()

  if (!value) {
    return { error: 'Paste or type the key first.' }
  }

  if (looksRedacted(value)) {
    return { error: 'That’s the hidden preview, not the key. Paste the whole key.' }
  }

  if (/[^\x00-\x7F]/.test(value)) {
    return { error: 'This has characters that aren’t plain letters or digits, usually from copying out of a PDF or a web page. Copy it again from where you got it.' }
  }

  return { value }
}

/** Saves one key in this bot's `.env` (a new one, or in place of the old value). The value is sent once, in the body, and kept nowhere. */
export async function saveEnvKey(config: ServerConfig, profile: string, name: string, raw: string): Promise<void> {
  if (!isEnvName(name)) {
    throw new EnvError(null, 'A name is letters, digits and _, and doesn’t start with a digit.')
  }

  const cleaned = cleanValue(raw)

  if ('error' in cleaned) {
    throw new EnvError(null, cleaned.error)
  }

  await request(config, 'PUT', profile, { key: name, value: cleaned.value, profile })
}

/** Removes one key from this bot's `.env` (and the credential pool and config mirrors). False when it was already gone. */
export async function removeEnvKey(config: ServerConfig, profile: string, name: string): Promise<boolean> {
  try {
    await request(config, 'DELETE', profile, { key: name, profile })

    return true
  } catch (error) {
    if (error instanceof EnvError && error.missingKey) {
      return false
    }

    throw error
  }
}

/** A custom name that reads like a credential (`MY_API_KEY`, `GITHUB_PAT`), not a setting (`TERMINAL_TIMEOUT`). */
const SECRET_NAME = /(^|_)(KEY|KEYS|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PAT|CREDENTIALS?|AUTH|COOKIE|DSN)(_|$)|KEY$|TOKEN$|SECRET$/i

/** Whether a set row belongs with the keys, or with the bot's other `.env` settings. */
export const isKeyLike = (row: EnvKey): boolean => (row.custom ? SECRET_NAME.test(row.name) : row.secret)

const byName = (a: EnvKey, b: EnvKey) => a.name.localeCompare(b.name)

/** What the Keys screen lists: what is set (channel credentials stay on Hermes's Channels page), keys first, each part by name. */
export function setKeys(rows: readonly EnvKey[]): { keys: EnvKey[]; other: EnvKey[] } {
  const set = rows.filter(row => row.isSet && !row.channel).sort(byName)

  return { keys: set.filter(isKeyLike), other: set.filter(row => !isKeyLike(row)) }
}

const fold = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '')

/**
 * The known keys that match what was typed, for Add key: secrets the bot doesn't have yet, best first (a name that starts with it,
 * then one that holds it, then a description or provider that does), at most `limit`. Every word typed must match somewhere.
 */
export function matchKeys(rows: readonly EnvKey[], query: string, limit = 5): EnvKey[] {
  const words = query.trim().split(/\s+/).map(fold).filter(Boolean)

  if (!words.length) {
    return []
  }

  const whole = fold(query)
  const ranked: { row: EnvKey; rank: number }[] = []

  for (const row of rows) {
    if (row.isSet || row.channel || row.custom || !row.secret) {
      continue
    }

    const name = fold(row.name)
    const about = fold(`${row.description} ${row.provider}`)

    if (!words.every(word => name.includes(word) || about.includes(word))) {
      continue
    }

    ranked.push({ row, rank: name.startsWith(whole) ? 0 : name.includes(whole) ? 1 : 2 })
  }

  return ranked
    .sort((a, b) => a.rank - b.rank || byName(a.row, b.row))
    .slice(0, limit)
    .map(entry => entry.row)
}

/** A name of the person's own is offered only in the usual form (`MY_SERVICE_KEY`): a lowercase word is a search, not a name. */
const NEW_NAME = /^[A-Z_][A-Z0-9_]*$/

/**
 * The exact name typed, when the matches don't already offer it: a key of the person's own (`row` null), a known name that isn't a
 * secret (a base URL), or one the bot already has, to change. Null for what can't be a name, and for a channel credential.
 */
export function typedName(rows: readonly EnvKey[], query: string, matches: readonly EnvKey[]): { name: string; row: EnvKey | null } | null {
  const name = query.trim()

  if (!isEnvName(name) || matches.some(row => row.name === name)) {
    return null
  }

  const row = rows.find(entry => entry.name === name) ?? null

  if (!row) {
    return NEW_NAME.test(name) ? { name, row: null } : null
  }

  return row.channel ? null : { name, row }
}

/** `console.x.ai` for a docs link's line. */
export const linkHost = (url: string): string => url.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '')

/** The key xAI's voice and search features read: once a bot has it, Hermes's own xAI text-to-speech and x_search use it. */
export const XAI_KEY = 'XAI_API_KEY'
