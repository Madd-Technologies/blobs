import { ScrollView, StyleSheet, View } from 'react-native'

import { Press } from '@/components/ui/Press'
import { T } from '@/components/ui/T'
import { dashboardHeadline } from '@/features/dashboard/headline'
import type { BotView } from '@/features/roster/view'
import { faceColor } from '@/lib/hermes/faceColor'
import { useDashboards } from '@/stores/dashboards'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, tintLevel } from '@/theme/tokens'

import { AttentionDot } from './AttentionDot'
import { BotFace } from './BotFace'

interface Props {
  /** The pinned bots, in their order. */
  views: BotView[]
  onOpen: (profile: string) => void
  /** The server's clock, for "Updated 9:41". */
  nowS: number
}

const TILE = 148

/**
 * The pinned bots' dashboards, under a "Dashboards" title: a strip that scrolls sideways, so one or twelve look right. Each
 * tile is the bot's own paper with what its dashboard holds (what waits on you there, else its headline figure), never its
 * chat: the chats are the rows below.
 */
export function DashboardStrip({ views, onOpen, nowS }: Props) {
  if (!views.length) {
    return null
  }

  return (
    <View>
      <T variant="rowTitle" color="text2" style={styles.title} accessibilityRole="header">
        Dashboards
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} accessibilityLabel="Dashboards">
        {views.map(view => (
          <DashboardTile key={view.profile} view={view} nowS={nowS} onOpen={onOpen} />
        ))}
      </ScrollView>
    </View>
  )
}

function DashboardTile({ view, nowS, onOpen }: { view: BotView; nowS: number; onOpen: (profile: string) => void }) {
  const { scheme } = useTheme()
  const dashboard = useDashboards(state => state.byBot[view.profile]?.dashboard)
  const waiting = useDashboards(state => state.summary[view.profile]?.needs_you ?? 0)
  const headline = dashboardHeadline(dashboard, waiting, dashboard?.now || nowS)

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${view.name}'s dashboard${headline.figure || headline.caption ? `: ${[headline.figure, headline.caption].filter(Boolean).join(' ')}` : ''}${headline.needsYou ? ', needs you' : ''}`}
      onPress={() => onOpen(view.profile)}
      style={[styles.tile, { backgroundColor: tintLevel(scheme, 'pinned', faceColor(view.profile, view.meta)) }]}
    >
      <View style={styles.top}>
        <BotFace name={view.profile} meta={view.meta} size={22} />
        <T variant="label" numberOfLines={1} style={styles.name}>
          {view.name}
        </T>
        {headline.needsYou ? <AttentionDot size={8} /> : null}
      </View>
      <View>
        {headline.figure ? (
          <T variant="stat" numberOfLines={1} adjustsFontSizeToFit style={styles.figure}>
            {headline.figure}
          </T>
        ) : null}
        <T variant="meta" color="text2" numberOfLines={headline.figure ? 1 : 2}>
          {headline.caption}
        </T>
      </View>
    </Press>
  )
}

const styles = StyleSheet.create({
  title: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 },
  strip: { gap: 10, paddingHorizontal: 16 },
  tile: { width: TILE, height: 104, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 12, borderRadius: radius.list, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, minWidth: 0, fontFamily: fonts.semibold },
  figure: { fontSize: 24, lineHeight: 28, letterSpacing: -0.4 },
})
