import { create } from 'zustand'

import type { ChatSummary } from '@/features/sessions/store'
import { sessions } from '@/stores/sessions'

interface BotChats {
  /** The side chats read so far, newest started first. */
  listed: ChatSummary[]
  inbox: ChatSummary | null
  /** How many chats the server has in all, so the screen knows whether to read more. */
  total: number
  /** A further page is being read. */
  more: boolean
  error: string | null
}

interface ChatListState {
  /** Each bot's stored chats and its inbox (null when it has none) as last read from the server; absent until the first read finishes. */
  byBot: Record<string, BotChats | undefined>
  load: (profile: string) => Promise<void>
  /** Reads the next page, if there is one and none is being read. */
  loadMore: (profile: string) => Promise<void>
  /** Takes a deleted chat out of the list, keeping the pages already read. */
  drop: (profile: string, id: string) => void
}

const failure = (error: unknown) => (error instanceof Error ? error.message : 'Could not load the chats.')

/** The history list on the Chats screen, a page at a time. Kept in a store so reading it is not a state change inside an effect. */
export const useChatList = create<ChatListState>((set, get) => ({
  byBot: {},
  load: async profile => {
    try {
      // A server without the inbox has no chat by its title; a lookup that fails only leaves the row out.
      const [page, inbox] = await Promise.all([sessions.listChats(profile), sessions.findInbox(profile).catch(() => null)])
      set(state => ({ byBot: { ...state.byBot, [profile]: { listed: page.chats, inbox, total: page.total, more: false, error: null } } }))
    } catch (error) {
      set(state => {
        const known = state.byBot[profile]

        return { byBot: { ...state.byBot, [profile]: { listed: known?.listed ?? [], inbox: known?.inbox ?? null, total: known?.total ?? 0, more: false, error: failure(error) } } }
      })
    }
  },
  loadMore: async profile => {
    const known = get().byBot[profile]

    if (!known || known.more || known.listed.length >= known.total) {
      return
    }

    set(state => ({ byBot: { ...state.byBot, [profile]: { ...known, more: true } } }))

    try {
      const page = await sessions.listChats(profile, known.listed.length)
      set(state => {
        const current = state.byBot[profile] ?? known
        const seen = new Set(current.listed.map(chat => chat.id))

        // A chat started while reading shifts the pages by one: the same chat can come back, and is kept once.
        return { byBot: { ...state.byBot, [profile]: { ...current, listed: [...current.listed, ...page.chats.filter(chat => !seen.has(chat.id))], total: page.total, more: false } } }
      })
    } catch (error) {
      set(state => ({ byBot: { ...state.byBot, [profile]: { ...(state.byBot[profile] ?? known), more: false, error: failure(error) } } }))
    }
  },
  drop: (profile, id) =>
    set(state => {
      const known = state.byBot[profile]

      if (!known?.listed.some(chat => chat.id === id)) {
        return state
      }

      return { byBot: { ...state.byBot, [profile]: { ...known, listed: known.listed.filter(chat => chat.id !== id), total: Math.max(0, known.total - 1) } } }
    }),
}))
