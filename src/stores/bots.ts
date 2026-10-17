import { useMemo } from 'react'
import { useStore } from 'zustand'

import { buildBotViews, type BotView } from '@/features/roster/view'
import { faceColor } from '@/lib/hermes/faceColor'
import type { BotMeta } from '@/lib/hermes/identity'
import { useNow } from '@/lib/useNow'
import { inbox, useAttentionMap, useInbox } from '@/stores/inbox'
import { useRoster } from '@/stores/roster'
import { useVisible } from '@/stores/visible'
import { sessions } from '@/stores/sessions'

/** One view per bot for lists: name, preview, attention, age. Recomputed only when its inputs change. */
export function useBotViews(options: { includeHidden?: boolean } = {}): BotView[] {
  const roster = useRoster(state => state.rows)
  const attention = useAttentionMap()
  const { byBot } = useInbox()
  const bots = useStore(sessions.store, state => state.bots)
  const visible = useVisible(state => state.byBot)
  const background = useStore(inbox.store, state => state.background)
  const now = useNow()
  const includeHidden = options.includeHidden

  return useMemo(() => buildBotViews({ roster, attention, inbox: byBot, sessions: bots, now, includeHidden, visible, background }), [roster, attention, byBot, bots, now, includeHidden, visible, background])
}

export function useBotView(profile: string): BotView | undefined {
  return useBotViews({ includeHidden: true }).find(view => view.profile === profile)
}

/** Each bot's look (`ui_meta['hermes-bots']`) by profile, for drawing faces where there is no full view (rooms). */
export function useBotMetas(): Record<string, BotMeta | undefined> {
  const rows = useRoster(state => state.rows)

  return useMemo(() => Object.fromEntries(rows.map(row => [row.name, row.ui_meta?.['hermes-bots']])), [rows])
}

/** The color a bot's face is drawn in, which tints the paper of its own screens. */
export function useFaceColor(profile: string): string {
  const meta = useRoster(state => state.rows.find(row => row.name === profile)?.ui_meta?.['hermes-bots'])

  return useMemo(() => faceColor(profile, meta), [profile, meta])
}
