import { useMemo } from 'react'
import { useStore } from 'zustand'

import { buildBotViews, type BotView } from '@/features/roster/view'
import { isPinned } from '@/features/roster/derive'
import { faceColor } from '@/lib/hermes/faceColor'
import { displayName, type BotMeta } from '@/lib/hermes/identity'
import type { ProfileRow } from '@/lib/hermes/protocol'
import { useNow } from '@/lib/useNow'
import { inbox, useAttentionMap, useInbox } from '@/stores/inbox'
import { useRoster } from '@/stores/roster'
import { useVisible } from '@/stores/visible'
import { sessions } from '@/stores/sessions'

export interface BotIdentity {
  profile: string
  name: string
  meta: BotMeta | undefined
  row: ProfileRow
  pinned: boolean
  color: string
}

/** Lightweight bot metadata from the roster alone — does not re-render on streaming tokens or clock ticks. */
export function useBotIdentity(profile: string): BotIdentity | undefined {
  const row = useRoster(state => state.rows.find(entry => entry.name === profile))

  return useMemo(() => {
    if (!row) {
      return undefined
    }

    const meta = row.ui_meta?.['hermes-bots']

    return {
      profile: row.name,
      name: displayName(row, meta),
      meta,
      row,
      pinned: isPinned(row),
      color: faceColor(row.name, meta),
    }
  }, [row])
}

/** Lightweight bot name/meta/pin lookup keyed by profile, reading only the roster. */
export function useBotDirectory(): Record<string, { name: string; meta: BotMeta | undefined; pinned: boolean }> {
  const rows = useRoster(state => state.rows)

  return useMemo(
    () =>
      Object.fromEntries(
        rows.map(row => {
          const meta = row.ui_meta?.['hermes-bots']

          return [row.name, { name: displayName(row, meta), meta, pinned: isPinned(row) }]
        }),
      ),
    [rows],
  )
}

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
