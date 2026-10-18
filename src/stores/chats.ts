import { create } from 'zustand'

import type { ChatSummary } from '@/features/sessions/store'
import { sessions } from '@/stores/sessions'

interface ChatListState {
  /** Each bot's stored chats and its inbox (null when it has none) as last read from the server; absent until the first read finishes. */
  byBot: Record<string, { listed: ChatSummary[]; inbox: ChatSummary | null; error: string | null } | undefined>
  load: (profile: string) => Promise<void>
}

/** The history list on the Chats screen. Kept in a store so reading it is not a state change inside an effect. */
export const useChatList = create<ChatListState>(set => ({
  byBot: {},
  load: async profile => {
    try {
      // A server without the inbox has no chat by its title; a lookup that fails only leaves the row out.
      const [listed, inbox] = await Promise.all([sessions.listChats(profile), sessions.findInbox(profile).catch(() => null)])
      set(state => ({ byBot: { ...state.byBot, [profile]: { listed, inbox, error: null } } }))
    } catch (error) {
      set(state => ({
        byBot: {
          ...state.byBot,
          [profile]: { listed: state.byBot[profile]?.listed ?? [], inbox: state.byBot[profile]?.inbox ?? null, error: error instanceof Error ? error.message : 'Could not load the chats.' },
        },
      }))
    }
  },
}))
