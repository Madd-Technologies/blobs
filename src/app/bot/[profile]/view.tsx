import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { PanelMenu } from '@/components/dashboard/PanelMenu'
import { useRowActions } from '@/components/dashboard/useRowActions'
import { RecordRow, ViewBlock } from '@/components/dashboard/ViewBlock'
import { IconCircle } from '@/components/ui/IconCircle'
import { Screen } from '@/components/ui/Screen'
import { T } from '@/components/ui/T'
import { askAboutPanel } from '@/features/dashboard/view'
import type { View as DashboardView } from '@/lib/hermes/dashboard'
import { useNow } from '@/lib/useNow'
import { useBotView } from '@/stores/bots'
import { startDashboardPoll, useBotBoard, useDashboards } from '@/stores/dashboards'
import { useDrafts } from '@/stores/drafts'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** One panel full screen: a board's columns side by side, or a list or table with every row. */
export default function PanelFullView() {
  const { profile, id } = useLocalSearchParams<{ profile: string; id: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const bot = useBotView(profile)
  const board = useBotBoard(profile)
  const [pulling, setPulling] = useState(false)
  const [menu, setMenu] = useState<DashboardView | null>(null)
  const clock = useNow(60)
  const name = bot?.name ?? profile
  const view = board.dashboard?.views.find(candidate => candidate.id === id) ?? null
  const nowS = board.dashboard?.now || clock

  const rows = useRowActions(nowS, () => name)

  useFocusEffect(useCallback(() => startDashboardPoll(profile), [profile]))

  const openRecord = (record: string) => router.push({ pathname: '/bot/[profile]/record', params: { profile, id: record } })

  async function onPull() {
    setPulling(true)
    await useDashboards.getState().load(profile)
    setPulling(false)
  }

  async function checkNow(panel: DashboardView) {
    setMenu(null)
    const result = await useDashboards.getState().checkPanel(profile, panel)

    if ('error' in result) {
      toast(`Couldn’t check: ${result.error}`)
    } else if (result.started === 0) {
      toast(`No routine keeps this dashboard yet. Ask ${name} to check on a schedule.`)
    }
  }


  const refresh = <RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />
  const hidden = view?.kind === 'board' ? view.columns.slice(2) : []

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/bot/[profile]/dashboard', params: { profile } }))} />
          <View style={styles.flex}>
            <T variant="heading" numberOfLines={1}>
              {view?.title ?? 'Panel'}
            </T>
            <T variant="status" color="text2" numberOfLines={1}>
              {view?.open !== undefined ? `${name} · ${view.open} open` : name}
            </T>
          </View>
          {view ? <IconCircle icon="more-horizontal" label={`${view.title} options`} onPress={() => setMenu(view)} /> : null}
        </View>

        {view?.kind === 'board' ? (
          <>
            <ScrollView style={styles.flex} contentContainerStyle={styles.boardBody} refreshControl={refresh}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.columns}>
                {view.columns.map(column => (
                  <View key={column.name} accessibilityLabel={column.name} style={[styles.column, { backgroundColor: c.sheet }]}>
                    <View style={styles.columnHead}>
                      <T variant="heading" numberOfLines={1} style={styles.flex} accessibilityRole="header">
                        {column.name}
                      </T>
                      <T variant="label" color="text2">
                        {column.count}
                      </T>
                    </View>
                    {column.rows.length ? (
                      column.rows.map((row, index) => (
                        <View key={row.id}>
                          {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
                          <RecordRow row={row} nowS={nowS} onPress={() => openRecord(row.id)} />
                        </View>
                      ))
                    ) : (
                      <T variant="secondary" color="text2" style={styles.none}>
                        Nothing here.
                      </T>
                    )}
                  </View>
                ))}
              </ScrollView>
            </ScrollView>
            <T variant="label" color="text2" style={styles.footnote}>
              {hidden.length ? `Swipe for ${hidden.map(column => `${column.name} (${column.count})`).join(', ')}. ` : ''}
              {name} moves items as it hears back; open one to change it yourself.
            </T>
          </>
        ) : view ? (
          <ScrollView style={styles.flex} contentContainerStyle={styles.body} refreshControl={refresh}>
            <ViewBlock view={view} nowS={nowS} bare onOpenRecord={openRecord} onToggle={(id, done) => rows.toggle(profile, id, done)} onMute={view.collection ? row => rows.mute(profile, row) : undefined} onMenu={() => setMenu(view)} onOpenFull={() => undefined} />
          </ScrollView>
        ) : board.loaded ? (
          <View style={styles.gone}>
            <T variant="secondary" color="text2" style={styles.centered}>
              {board.error ? `Couldn’t load this panel: ${board.error}` : `${name} has taken this panel down.`}
            </T>
          </View>
        ) : null}

        {rows.sheet}

        <PanelMenu
          view={menu}
          profile={profile}
          botName={name}
          onClose={() => setMenu(null)}
          onAsk={target => {
            setMenu(null)
            useDrafts.getState().set(profile, askAboutPanel(target))
            router.push({ pathname: '/bot/[profile]', params: { profile } })
          }}
          onCheck={panel => void checkNow(panel)}
        />
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  boardBody: { paddingTop: 8, paddingBottom: 16 },
  columns: { paddingHorizontal: 16, gap: 12, alignItems: 'flex-start' },
  column: { width: 280, borderRadius: radius.group, overflow: 'hidden', paddingBottom: 6 },
  columnHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  separator: { height: 1, marginLeft: 36 },
  none: { paddingHorizontal: 16, paddingVertical: 10 },
  footnote: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
})
