import { create } from 'zustand'

import { mergeHits, searchSessions, type SessionHit } from '@/lib/hermes/search'
import { useConnection } from '@/stores/connection'

/** One slow bot must not hold up the rest. */
const PER_BOT_TIMEOUT_MS = 8000

interface MessageSearchState {
  hits: SessionHit[]
  /** The words the hits are for, and whether a search for newer words is still running. */
  forQuery: string
  searching: boolean
  /** Why no bot could be searched (the first failure), when every one failed. */
  error: string | null
  run: (query: string, profiles: string[]) => Promise<void>
  clear: () => void
}

let latest = 0

const timeout = <T,>(promise: Promise<T>, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), PER_BOT_TIMEOUT_MS))])

/**
 * Searching what was said in the bots' chats, from Home. The server searches one bot at a time, so every bot is asked at once
 * and the answers are put together; a bot that fails or is slow just adds nothing. Only the newest search is kept.
 */
export const useMessageSearch = create<MessageSearchState>(set => ({
  hits: [],
  forQuery: '',
  searching: false,
  error: null,
  run: async (query, profiles) => {
    const config = useConnection.getState().config
    const mine = ++latest

    if (!config || !query.trim()) {
      set({ hits: [], forQuery: '', searching: false, error: null })

      return
    }

    set({ searching: true, error: null })

    const failures: string[] = []

    const perBot = await Promise.all(
      profiles.map(profile =>
        timeout(
          searchSessions(config, profile, query).catch((error: unknown) => {
            failures.push(error instanceof Error ? error.message : 'search failed')

            return [] as SessionHit[]
          }),
          [] as SessionHit[],
        ),
      ),
    )

    if (mine === latest) {
      set({ hits: mergeHits(perBot), forQuery: query.trim(), searching: false, error: profiles.length && failures.length === profiles.length ? (failures[0] as string) : null })
    }
  },
  clear: () => {
    latest++
    set({ hits: [], forQuery: '', searching: false, error: null })
  },
}))
