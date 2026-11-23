import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { ageLabel } from '@/features/roster/derive'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useStation } from '@/stores/station'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

type KindFilter = 'all' | 'failed' | 'routines' | 'replies'

const FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'routines', label: 'Routines' },
  { key: 'replies', label: 'Replies' },
]

export default function BriefingScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const briefing = useStation(state => state.briefing)
  const refreshBriefing = useStation(state => state.refreshBriefing)
  const ackBriefing = useStation(state => state.ackBriefing)
  const views = useBotViews({ includeHidden: true })
  const metas = useBotMetas()
  const nowS = useNow(60)
  const [filter, setFilter] = useState<KindFilter>('all')
  const [pulling, setPulling] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshBriefing()
  }, [refreshBriefing])

  const events = useMemo(() => {
    const list = briefing?.events ?? []
    switch (filter) {
      case 'failed':
        return list.filter(ev => ev.status === 'failed')
      case 'routines':
        return list.filter(ev => ev.kind === 'routine')
      case 'replies':
        return list.filter(ev => ev.kind === 'reply')
      default:
        return list
    }
  }, [briefing, filter])

  const botEntries = useMemo(
    () =>
      Object.entries(briefing?.by_bot ?? {}).sort((a, b) => b[1].latest_at - a[1].latest_at),
    [briefing],
  )

  const botName = (profile: string) => views.find(view => view.profile === profile)?.name ?? profile

  async function onPull() {
    setPulling(true)
    await refreshBriefing()
    setPulling(false)
  }

  async function catchUp() {
    setBusy(true)
    const error = await ackBriefing()
    setBusy(false)

    if (error) {
      toast(error)
    } else {
      toast('Marked caught up')
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        title="While you were away"
        subtitle={briefing ? `${briefing.counts.total} events` : undefined}
        right={
          briefing && briefing.counts.total > 0 ? (
            <Pill label="Catch up" variant="primary" height={36} loading={busy} onPress={() => void catchUp()} />
          ) : undefined
        }
      />

      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map(item => {
            const active = filter === item.key

            return (
              <Press
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(item.key)}
                style={[styles.chip, { backgroundColor: active ? c.primary : c.control }]}
              >
                <T variant="label" color={active ? 'onPrimary' : 'text'} style={styles.chipText}>
                  {item.label}
                </T>
              </Press>
            )
          })}
        </ScrollView>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item, idx) => `${item.at}:${item.profile}:${item.kind}:${idx}`}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          botEntries.length > 0 ? (
            <View style={styles.botSummaryWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.botSummaryRow}>
                {botEntries.map(([profile, stats]) => (
                  <Press
                    key={profile}
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/bot/[profile]', params: { profile } })}
                    style={[styles.botTile, { backgroundColor: c.sheet }]}
                  >
                    <BotFace name={profile} meta={metas[profile]} size={24} />
                    <View>
                      <T variant="label" style={styles.chipText}>
                        {botName(profile)}
                      </T>
                      <T variant="meta" color={stats.failed > 0 ? 'danger' : 'text2'}>
                        {stats.total} {stats.failed > 0 ? `· ${stats.failed} failed` : 'updates'}
                      </T>
                    </View>
                  </Press>
                ))}
              </ScrollView>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const isFirst = index === 0
          const isLast = index === events.length - 1
          const rStyle = {
            borderTopLeftRadius: isFirst ? radius.group : 0,
            borderTopRightRadius: isFirst ? radius.group : 0,
            borderBottomLeftRadius: isLast ? radius.group : 0,
            borderBottomRightRadius: isLast ? radius.group : 0,
          }

          return (
            <View style={[rStyle, { backgroundColor: c.sheet }]}>
              {index > 0 ? <View style={[styles.sep, { backgroundColor: c.separator }]} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${botName(item.profile)}: ${item.summary}`}
                onPress={() =>
                  item.profile ? router.push({ pathname: '/bot/[profile]', params: { profile: item.profile } }) : undefined
                }
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
              >
                <BotFace name={item.profile || 'default'} meta={metas[item.profile]} size={28} />
                <View style={styles.flex}>
                  <View style={styles.rowTop}>
                    <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
                      {botName(item.profile)}
                    </T>
                    <T variant="meta" color={item.status === 'failed' ? 'danger' : 'text2'}>
                      {ageLabel(item.at, nowS) || item.kind}
                    </T>
                  </View>
                  <T variant="secondary" color="text2" numberOfLines={2}>
                    {item.summary}
                  </T>
                </View>
              </Pressable>
            </View>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <T variant="heading">All caught up</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              {briefing === null
                ? 'Update hermes-bot-mobile on your server to see overnight activity summaries.'
                : 'No new replies, routines, or failures since your last catch-up.'}
            </T>
          </View>
        }
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  filterWrap: { paddingTop: 10, paddingBottom: 10 },
  filterRow: { paddingHorizontal: 16, gap: 8 },
  chip: { height: 34, borderRadius: radius.pill, paddingHorizontal: 14, justifyContent: 'center' },
  chipText: { fontFamily: fonts.medium },
  botSummaryWrap: { paddingBottom: 14 },
  botSummaryRow: { gap: 8 },
  botTile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.list },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  sep: { height: 1, marginLeft: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  empty: { paddingTop: 72, paddingHorizontal: 32, alignItems: 'center', gap: 6 },
  centered: { textAlign: 'center' },
})
