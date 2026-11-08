import { create } from 'zustand'

import { fetchWholeRows, WHOLE_MAX } from '@/lib/hermes/history'
import type { StoredMessage } from '@/lib/hermes/rest'
import { useConnection } from '@/stores/connection'
import { sessions } from '@/stores/sessions'

/**
 * The whole rows behind tool steps a chat was read light with (hermes-bot-mobile's history): a step's line came with only the
 * end of its output, and its row is fetched here when the step is drawn (the chat draws a few screens around what is in view),
 * so a tap shows it at once. Keyed by bot and row id (row ids are unique in a bot's own store).
 */
interface WholeRowsState {
  rows: Record<string, StoredMessage>
}

export const useWholeRows = create<WholeRowsState>(() => ({ rows: {} }))

export const wholeKey = (profile: string, id: string | number): string => `${profile}#${id}`

/** How long to gather asks before one fetch: the lines of a screen are drawn within a frame or two of each other. */
const GATHER_MS = 120

const waiting = new Map<string, Set<string>>()
const asked = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

/** Asks for these rows of a bot's open chat, once each, gathered with the asks around them. */
export function wantWholeRows(profile: string, ids: readonly (string | number)[]): void {
  for (const id of ids) {
    const key = wholeKey(profile, id)

    if (asked.has(key)) {
      continue
    }

    asked.add(key)
    waiting.set(profile, (waiting.get(profile) ?? new Set()).add(String(id)))
  }

  if (waiting.size && !timer) {
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, GATHER_MS)
  }
}

async function flush(): Promise<void> {
  const config = useConnection.getState().config
  const batch = [...waiting.entries()]
  waiting.clear()

  for (const [profile, wanted] of batch) {
    const storedId = sessions.store.getState().bots[profile]?.storedId
    const ids = [...wanted]

    if (!config || !storedId) {
      // Asked again the next time the step is drawn.
      ids.forEach(id => asked.delete(wholeKey(profile, id)))
      continue
    }

    for (let start = 0; start < ids.length; start += WHOLE_MAX) {
      const chunk = ids.slice(start, start + WHOLE_MAX)

      try {
        const rows = await fetchWholeRows(config, storedId, profile, chunk)

        if (rows.length) {
          useWholeRows.setState(state => ({ rows: { ...state.rows, ...Object.fromEntries(rows.map(row => [wholeKey(profile, row.id), row])) } }))
        }
      } catch {
        // The step keeps the end of its output it came with; it is asked for again when drawn next.
        chunk.forEach(id => asked.delete(wholeKey(profile, id)))
      }
    }
  }
}

// Another server's rows mean nothing on this one.
useConnection.subscribe((state, previous) => {
  if (state.config?.baseUrl !== previous.config?.baseUrl) {
    asked.clear()
    waiting.clear()
    useWholeRows.setState({ rows: {} })
  }
})
