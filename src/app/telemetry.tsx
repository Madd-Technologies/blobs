import { useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useStation } from '@/stores/station'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

const WINDOWS = [7, 14, 30] as const

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

export default function TelemetryScreen() {
  const { c } = useTheme()
  const telemetry = useStation(state => state.telemetry)
  const loadTelemetry = useStation(state => state.loadTelemetry)
  const metas = useBotMetas()
  const views = useBotViews({ includeHidden: true })
  const [days, setDays] = useState<number>(7)
  const [pulling, setPulling] = useState(false)

  useEffect(() => {
    void loadTelemetry(days)
  }, [days, loadTelemetry])

  const botName = (profile: string) => views.find(view => view.profile === profile)?.name ?? profile

  async function onPull() {
    setPulling(true)
    await loadTelemetry(days)
    setPulling(false)
  }

  const maxDailyTokens = Math.max(1, ...(telemetry?.daily.map(d => d.tokens) ?? [0]))
  const botRows = Object.entries(telemetry?.by_bot ?? {}).sort((a, b) => b[1].total_tokens - a[1].total_tokens || b[1].sessions - a[1].sessions)
  const modelRows = Object.entries(telemetry?.by_model ?? {}).sort((a, b) => b[1].tokens - a[1].tokens || b[1].sessions - a[1].sessions)

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Usage & cost" subtitle={`Last ${days} days`} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}
      >
        <View style={styles.windowRow}>
          {WINDOWS.map(win => (
            <Pill
              key={win}
              label={`${win}d`}
              variant={days === win ? 'primary' : 'secondary'}
              height={36}
              flex
              onPress={() => setDays(win)}
            />
          ))}
        </View>

        {telemetry ? (
          <>
            <View style={[styles.kpiGrid, { backgroundColor: c.sheet }]}>
              <View style={styles.kpiCell}>
                <T variant="meta" color="text2">
                  Sessions
                </T>
                <T variant="heading">{telemetry.totals.sessions}</T>
              </View>
              <View style={styles.kpiCell}>
                <T variant="meta" color="text2">
                  Messages
                </T>
                <T variant="heading">{telemetry.totals.messages}</T>
              </View>
              <View style={styles.kpiCell}>
                <T variant="meta" color="text2">
                  Tokens
                </T>
                <T variant="heading">{formatTokens(telemetry.totals.total_tokens)}</T>
              </View>
              <View style={styles.kpiCell}>
                <T variant="meta" color="text2">
                  Est. cost
                </T>
                <T variant="heading">{formatCost(telemetry.totals.cost_usd)}</T>
              </View>
            </View>

            {telemetry.daily.length > 0 ? (
              <>
                <T variant="meta" color="text2" style={styles.section}>
                  Daily volume
                </T>
                <View style={[styles.panel, { backgroundColor: c.sheet }]}>
                  {telemetry.daily.map(day => {
                    const ratio = Math.max(0.04, day.tokens / maxDailyTokens)

                    return (
                      <View key={day.date} style={styles.barRow}>
                        <T variant="monoSmall" color="text2" style={styles.dateCol}>
                          {day.date.slice(5)}
                        </T>
                        <View style={[styles.barTrack, { backgroundColor: c.tone }]}>
                          <View style={[styles.barFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: c.primary }]} />
                        </View>
                        <T variant="monoSmall" color="text2" style={styles.tokCol}>
                          {formatTokens(day.tokens)}
                        </T>
                      </View>
                    )
                  })}
                </View>
              </>
            ) : null}

            {botRows.length > 0 ? (
              <>
                <T variant="meta" color="text2" style={styles.section}>
                  By bot
                </T>
                <GroupedList>
                  {botRows.map(([profile, stats]) => (
                    <View key={profile} style={styles.botRow}>
                      <BotFace name={profile} meta={metas[profile]} size={24} />
                      <T variant="rowTitle" style={styles.flex} numberOfLines={1}>
                        {botName(profile)}
                      </T>
                      <T variant="label" color="text2" style={styles.statValue}>
                        {stats.sessions}s · {formatTokens(stats.total_tokens)}
                        {stats.cost_usd > 0 ? ` · ${formatCost(stats.cost_usd)}` : ''}
                      </T>
                    </View>
                  ))}
                </GroupedList>
              </>
            ) : null}

            {modelRows.length > 0 ? (
              <>
                <T variant="meta" color="text2" style={styles.section}>
                  By model
                </T>
                <GroupedList>
                  {modelRows.map(([model, stats]) => (
                    <Row
                      key={model}
                      label={model}
                      value={`${formatTokens(stats.tokens)}${stats.cost_usd > 0 ? ` · ${formatCost(stats.cost_usd)}` : ''}`}
                      chevron={false}
                    />
                  ))}
                </GroupedList>
              </>
            ) : null}
          </>
        ) : (
          <View style={styles.empty}>
            <T variant="heading">Telemetry unavailable</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              Update hermes-bot-mobile to 0.4.0+ on your server to inspect token and session usage.
            </T>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 16 },
  windowRow: { flexDirection: 'row', gap: 8 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: radius.group, padding: 16, rowGap: 14 },
  kpiCell: { width: '50%', gap: 2 },
  section: { paddingHorizontal: 4, marginBottom: -8 },
  panel: { borderRadius: radius.group, padding: 16, gap: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateCol: { width: 42 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  tokCol: { width: 46, textAlign: 'right' },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52, paddingVertical: 10 },
  statValue: { fontFamily: fonts.medium },
  empty: { paddingTop: 72, paddingHorizontal: 24, alignItems: 'center', gap: 6 },
  centered: { textAlign: 'center' },
})
