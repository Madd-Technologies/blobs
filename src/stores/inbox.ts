import { useMemo } from 'react'
import { AppState } from 'react-native'
import { create, useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import { matchActiveToBots, type Attention } from '@/features/attention/derive'
import { attentionFor, deriveInbox, type InboxEntry } from '@/features/inbox/derive'
import { NEEDS_YOU_EVENT, NEEDS_YOU_PATH } from '@/features/inbox/pushed'
import { visibleState } from '@/features/roster/visible'
import { createInbox } from '@/features/inbox/store'
import { supportsLiveHelpers } from '@/lib/hermes/capabilities'
import { HermesHttpError, restJson } from '@/lib/hermes/server'
import { startPoller } from '@/lib/poller'
import { useNow } from '@/lib/useNow'
import { gateway, onGatewayEvent, useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'
import { useSeen } from '@/stores/seen'
import { sessions } from '@/stores/sessions'
import { useVisible } from '@/stores/visible'

/** What is waiting on the user across all bots: pushed by the server when it can, polled from the gateway when not. */
export const inbox = createInbox({
  client: gateway,
  openLiveIds: () => new Set(Object.values(sessions.store.getState().bots).flatMap(bot => (bot.liveId ? [bot.liveId] : []))),
  liveHelpers: () => supportsLiveHelpers(useConnection.getState().serverVersion),
  readNeedsYou: async () => {
    const config = useConnection.getState().config

    if (!config) {
      return null
    }

    try {
      return await restJson(config, NEEDS_YOU_PATH, {}, { timeoutMs: 8_000 })
    } catch (error) {
      // No hermes-bot-mobile, or one older than 0.1.6: the app keeps its own check.
      if (error instanceof HermesHttpError && error.status === 404) {
        return null
      }

      throw error
    }
  },
})

/**
 * What waits on you arrives as the server's push, read once whenever the connection comes up or the app comes back to
 * the front. Status (who is working) is polled every 30 s in the foreground, and straight away when the server says
 * sessions changed.
 */
export function startInboxSync(): () => void {
  const refresh = () => void inbox.refresh()
  const stopPoll = startPoller(refresh, 30_000, () => useConnection.getState().status === 'online')
  let debounce: ReturnType<typeof setTimeout> | null = null

  const stopEvents = onGatewayEvent(event => {
    if ((event.type as string) === NEEDS_YOU_EVENT) {
      inbox.applyPushed(event.payload)

      return
    }

    if (event.type === 'sessions.changed' && !debounce) {
      debounce = setTimeout(() => {
        debounce = null
        refresh()
      }, 600)
    }
  })

  if (useConnection.getState().status === 'online') {
    void inbox.loadPushed()
  }

  const stopConnection = useConnection.subscribe((state, previous) => {
    if (!state.config && previous.config) {
      // Signed out: nothing of that server's is kept.
      inbox.store.setState({ pushed: null, polled: {} })
    } else if (state.status === 'online' && previous.status !== 'online') {
      void inbox.loadPushed()
    }
  })
  const foreground = AppState.addEventListener('change', next => {
    if (next === 'active' && useConnection.getState().status === 'online') {
      void inbox.loadPushed()
    }
  })

  return () => {
    stopPoll()
    stopEvents()
    stopConnection()
    foreground.remove()

    if (debounce) {
      clearTimeout(debounce)
    }
  }
}

/** The inbox entries and per-bot grouping, recomputed when the roster, chats or polled data change. */
export function useInbox() {
  const roster = useRoster(state => state.rows)
  const bots = useStore(sessions.store, state => state.bots)
  const { active, polled, pushed } = useStore(inbox.store, useShallow(state => ({ active: state.active, polled: state.polled, pushed: state.pushed })))

  return useMemo(() => {
    const knownLiveIds = sessions.knownLiveIds()
    const derived = deriveInbox({ roster, sessions: bots, active, polled, pushed, knownLiveIds })

    return { ...derived, activeByBot: matchActiveToBots(roster, active, knownLiveIds) }
  }, [roster, bots, active, polled, pushed])
}

/** How many things are waiting on the user. */
export function useInboxCount(): number {
  return useInbox().entries.length
}

/** Each bot's attention state (needs you / working / idle, plus unread), keyed by profile. */
export function useAttentionMap(): Record<string, Attention> {
  const roster = useRoster(state => state.rows)
  const { byBot, activeByBot } = useInbox()
  const seenAt = useSeen(state => state.seenAt)
  const openProfile = useOpenChat(state => state.profile)
  const visible = useVisible(state => state.byBot)
  const now = useNow()

  return useMemo(() => {
    return Object.fromEntries(
      roster.map(bot => {
        // Unread means something you would see: activity between bots does not count.
        const known = visibleState(visible[bot.name], bot.canonical_session)
        // Until it is read, nothing counts as unread: the server's activity time also counts messages between bots.
        const lastActive = known.kind === 'known' ? known.visible.ts : known.kind === 'pending' ? 0 : undefined

        return [bot.name, attentionFor(bot, { inbox: byBot as Map<string, InboxEntry[]>, activeByBot, lastActive }, { now, seenAt: seenAt[bot.name], isOpen: openProfile === bot.name })]
      }),
    )
  }, [roster, byBot, activeByBot, seenAt, openProfile, visible, now])
}

export function useBotAttention(profile: string): Attention | undefined {
  return useAttentionMap()[profile]
}

// ── which chat is on screen ──────────────────────────────────────────────────────────────────────

interface OpenChatState {
  /** The bot whose chat screen is showing, if any. Its activity is already seen. */
  profile: string | null
  setOpen: (profile: string | null) => void
}

export const useOpenChat = create<OpenChatState>(set => ({ profile: null, setOpen: profile => set({ profile }) }))
