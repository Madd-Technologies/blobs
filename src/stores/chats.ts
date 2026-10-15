import { create } from 'zustand'

import type { ChatSummary } from '@/features/sessions/store'
import { sessions } from '@/stores/sessions'

interface ChatListState {
  /** Each bot's stored chats as last read from the server; absent until the first read finishes. */
  byBot: Record<string, { listed: ChatSummary[]; error: string | null } | undefined>
  load: (profile: string) => Promise<void>
}

/** The history list on the Chats screen. Kept in a store so reading it is not a state change inside an effect. */
export const useChatList = create<ChatListState>(set => ({
  byBot: {},
  load: async profile => {
    try {
      const listed = await sessions.listChats(profile)
      set(state => ({ byBot: { ...state.byBot, [profile]: { listed, error: null } } }))
    } catch (error) {
      set(state => ({
        byBot: { ...state.byBot, [profile]: { listed: state.byBot[profile]?.listed ?? [], error: error instanceof Error ? error.message : 'Could not load the chats.' } },
      }))
    }
  },
}))
