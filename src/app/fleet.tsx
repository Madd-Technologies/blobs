import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { ageLabel } from '@/features/roster/derive'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useStation } from '@/stores/station'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

export default function FleetScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const fleet = useStation(state => state.fleet)
  const refreshFleet = useStation(state => state.refreshFleet)
  const pauseFleet = useStation(state => state.pauseFleet)
  const resumeFleet = useStation(state => state.resumeFleet)
  const metas = useBotMetas()
  const views = useBotViews({ includeHidden: true })
  const nowS = useNow(60)
  const [confirmPause, setConfirmPause] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshFleet()
  }, [refreshFleet])

  const botLabel = (profile: string, fallback: string) =>
    views.find(view => view.profile === profile)?.name ?? fallback

  async function onPull() {
    setPulling(true)
    await refreshFleet()
    setPulling(false)
  }

  async function handlePause() {
    setBusy(true)
    const error = await pauseFleet('Paused from Blobs app')
    setBusy(false)

    if (error) {
      toast(error)
    } else {
      toast('Fleet paused')
    }
  }

  async function handleResume() {
    setBusy(true)
    const error = await resumeFleet()
    setBusy(false)

    if (error) {
      toast(error)
    } else {
      toast('Fleet resumed')
    }
  }

  const bots = fleet?.bots ?? []

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Fleet control" subtitle={fleet ? `${bots.length} bots` : undefined} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}
      >
        {fleet ? (
          <>
            <Raised radius={radius.group} style={styles.statusCard}>
              <View style={styles.statusText}>
                <T variant="heading">{fleet.paused ? 'Fleet paused' : 'Fleet active'}</T>
                <T variant="secondary" color="text2">
                  {fleet.paused
                    ? fleet.reason || 'Background automation is paused across your server.'
                    : 'Bots and scheduled routines run normally.'}
                </T>
              </View>
              {fleet.paused ? (
                <Pill label="Resume fleet" variant="primary" height={46} loading={busy} onPress={() => void handleResume()} />
              ) : (
                <Pill label="Pause fleet" variant="destructive" height={46} loading={busy} onPress={() => setConfirmPause(true)} />
              )}
            </Raised>

            <T variant="meta" color="text2" style={styles.section}>
              Bots
            </T>
            <GroupedList>
              {bots.map((bot, idx) => (
                <View key={bot.profile}>
                  {idx > 0 ? <View style={[styles.sep, { backgroundColor: c.separator }]} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${botLabel(bot.profile, bot.name)}, ${bot.routines} routines`}
                    onPress={() => router.push({ pathname: '/bot/[profile]', params: { profile: bot.profile } })}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}
                  >
                    <BotFace name={bot.profile} meta={metas[bot.profile]} size={32} />
                    <View style={styles.rowText}>
                      <T variant="rowTitle" numberOfLines={1}>
                        {botLabel(bot.profile, bot.name)}
                      </T>
                      <T variant="label" color="text2" numberOfLines={1}>
                        {bot.routines} {bot.routines === 1 ? 'routine' : 'routines'}
                        {bot.last_active ? ` · active ${ageLabel(bot.last_active, nowS) || 'now'}` : ''}
                      </T>
                    </View>
                    <T variant="label" color={bot.paused ? 'danger' : 'text2'}>
                      {bot.paused ? 'Paused' : 'Active'}
                    </T>
                  </Pressable>
                </View>
              ))}
            </GroupedList>
          </>
        ) : (
          <View style={styles.empty}>
            <T variant="heading">Fleet control unavailable</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              Update hermes-bot-mobile to 0.4.0+ on your server to manage fleet state.
            </T>
          </View>
        )}
      </ScrollView>

      <ConfirmSheet
        visible={confirmPause}
        title="Pause entire fleet?"
        message="Background runs across all bots will stay paused until you resume."
        confirmLabel="Pause fleet"
        destructive
        onClose={() => setConfirmPause(false)}
        onConfirm={() => void handlePause()}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 16 },
  statusCard: { padding: 18, gap: 14 },
  statusText: { gap: 4 },
  section: { paddingHorizontal: 4, marginBottom: -8 },
  sep: { height: 1, marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  empty: { paddingTop: 72, paddingHorizontal: 24, alignItems: 'center', gap: 6 },
  centered: { textAlign: 'center' },
})
