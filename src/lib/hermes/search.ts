/**
 * Searching what was said in a bot's chats (`GET /api/sessions/search`). The server searches one profile at a time, over
 * every session that bot has had. Pure: no React Native imports.
 */

import { restJson, type ServerConfig } from './server.ts'

/** One chat a search found, with the part of a message that matched. */
export interface SessionHit {
  profile: string
  /** The stored id of the chat (the newest of a chain that was compressed). */
  sessionId: string
  /** The first chat of that chain: a bot's main chat can be matched by either id. */
  lineageRoot: string
  title: string
  /** Where the chat was started: `tui`, `cron`, a messaging platform… */
  source: string
  /** Who said it: `user` or `assistant`; empty when the chat matched by its id. */
  role: string
  /** What matched, with `>>>` and `<<<` around the words searched for. */
  snippet: string
  /** Epoch seconds the chat was last active; 0 when unknown. */
  lastActive: number
  messageCount: number
}

interface RawHit {
  session_id?: string
  id?: string
  lineage_root?: string
  title?: string | null
  source?: string | null
  role?: string | null
  snippet?: string | null
  last_active?: number | null
  session_started?: number | null
  started_at?: number | null
  message_count?: number | null
}

/** The chats of one bot whose messages (or id) match `query`. */
export async function searchSessions(config: ServerConfig, profile: string, query: string, limit = 8): Promise<SessionHit[]> {
  const q = query.trim()

  if (!q) {
    return []
  }

  const page = await restJson<{ results?: RawHit[] }>(config, `/api/sessions/search?q=${encodeURIComponent(q)}&limit=${limit}&profile=${encodeURIComponent(profile)}`)

  return (page.results ?? []).flatMap(raw => {
    const sessionId = raw.session_id ?? raw.id

    return sessionId
      ? [
          {
            profile,
            sessionId,
            lineageRoot: raw.lineage_root ?? sessionId,
            title: (raw.title ?? '').trim(),
            source: raw.source ?? '',
            role: raw.role ?? '',
            snippet: raw.snippet ?? '',
            lastActive: raw.last_active ?? raw.session_started ?? raw.started_at ?? 0,
            messageCount: raw.message_count ?? 0,
          } satisfies SessionHit,
        ]
      : []
  })
}

/** Wording that marks what the server wrote to a bot, or a bot wrote to another: not something anyone said to this chat. */
const NOT_SAID = /Message from 🤖|\[IMPORTANT: Background process|bot_mode_dm|\[System:/

/**
 * What is worth showing. The server answers with one match per chat (the first it finds), so this can only judge a whole
 * chat by that match: a routine's run has its own screen (and resuming it would disturb it), and a chat whose match is a
 * line bots sent each other is between bots. A match inside a tool's output stays: it is still something in that chat, and
 * dropping it would hide the chat even when its other messages match too.
 */
export function worthShowing(hit: SessionHit): boolean {
  return hit.source !== 'cron' && !NOT_SAID.test(hit.snippet)
}

export interface SnippetPart {
  text: string
  /** The words that were searched for. */
  hit: boolean
}

/** A snippet as quiet text with the matched words marked: markers removed, line breaks and runs of space collapsed. */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  // A match inside a tool call or its result is stored as JSON text: show it as the words it holds.
  const readable = snippet.replace(/\\"/g, '"').replace(/\\n/g, ' ')

  for (const [index, piece] of readable.split('>>>').entries()) {
    const [first = '', ...rest] = piece.split('<<<')

    // The first piece is plain text; every later one starts with a match, and ends it at the closing marker.
    if (index === 0) {
      parts.push({ text: first, hit: false })
    } else {
      parts.push({ text: first, hit: true }, { text: rest.join(''), hit: false })
    }
  }

  const squeezed = parts.map(part => ({ ...part, text: part.text.replace(/\s+/g, ' ') }))

  // Merge neighbours of the same kind and drop empty ones; trim the ends.
  const merged: SnippetPart[] = []

  for (const part of squeezed) {
    const last = merged.at(-1)

    if (last && last.hit === part.hit) {
      last.text += part.text
    } else if (part.text) {
      merged.push({ ...part })
    }
  }

  if (merged.length) {
    merged[0]!.text = merged[0]!.text.trimStart()
    merged[merged.length - 1]!.text = merged[merged.length - 1]!.text.trimEnd()
  }

  return merged.filter(part => part.text)
}

/** Whether a hit is the bot's main chat, which opens as the bot does rather than as a side chat. */
export function isMainChat(hit: SessionHit, canonical: { id?: string | null; resolved_id?: string | null } | null | undefined): boolean {
  const ids = [canonical?.id, canonical?.resolved_id].filter((id): id is string => !!id)

  return ids.includes(hit.sessionId) || ids.includes(hit.lineageRoot)
}

/** Every bot's hits in one list, newest chat first, a chat once, and at most `limit` of them. */
export function mergeHits(perBot: SessionHit[][], limit = 30): SessionHit[] {
  const seen = new Set<string>()

  return perBot
    .flat()
    .filter(worthShowing)
    .sort((a, b) => b.lastActive - a.lastActive)
    .filter(hit => {
      const key = `${hit.profile}:${hit.sessionId}`

      if (seen.has(key)) {
        return false
      }

      seen.add(key)

      return true
    })
    .slice(0, limit)
}
