import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { ageLabel } from '@/features/roster/derive'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useStation } from '@/stores/station'
import { toast } from '@/stores/ui'
import { fonts, radius } from '@/theme/tokens'

/**
 * Compact Home card summarizing overnight/background activity when `hermes-bot-mobile` 0.4+ has unseen events.
 */
export function BriefingCard() {
  const router = useRouter()
  const briefing = useStation(state => state.briefing)
  const ackBriefing = useStation(state => state.ackBriefing)
  const metas = useBotMetas()
  const views = useBotViews({ includeHidden: true })
  const nowS = useNow(60)
  const [busy, setBusy] = useState(false)

  if (!briefing || briefing.counts.total === 0) {
    return null
  }

  const { counts, events } = briefing
  const summaryParts = [
    counts.replies > 0 ? `${counts.replies} ${counts.replies === 1 ? 'reply' : 'replies'}` : '',
    counts.routines > 0 ? `${counts.routines} ${counts.routines === 1 ? 'routine' : 'routines'}` : '',
    counts.approvals > 0 ? `${counts.approvals} ${counts.approvals === 1 ? 'approval' : 'approvals'}` : '',
    counts.failed > 0 ? `${counts.failed} failed` : '',
  ].filter(Boolean)

  const subtitle = summaryParts.join(' · ') || `${counts.total} recent updates`
  const preview = events.slice(0, 3)

  async function catchUp() {
    setBusy(true)
    const error = await ackBriefing()
    setBusy(false)

    if (error) {
      toast(error)
    }
  }

  return (
    <View style={styles.wrap}>
      <Raised radius={radius.group} style={styles.card} accessibilityLabel={`While you were away, ${subtitle}`}>
        <View style={styles.header}>
          <T variant="heading" style={styles.flex}>
            While you were away
          </T>
          <T variant="meta" color="text2">
            {counts.total}
          </T>
        </View>
        <T variant="secondary" color="text2" numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </T>
        <View style={styles.rows}>
          {preview.map((event, index) => {
            const botName = views.find(view => view.profile === event.profile)?.name ?? event.profile
            const age = ageLabel(event.at, nowS)

            return (
              <Press
                key={`${event.at}:${event.profile}:${index}`}
                accessibilityRole="button"
                accessibilityLabel={`${botName}: ${event.summary}`}
                onPress={() =>
                  event.profile
                    ? router.push({ pathname: '/bot/[profile]', params: { profile: event.profile } })
                    : router.push('/briefing')
                }
                style={styles.row}
              >
                <BotFace name={event.profile || 'default'} meta={metas[event.profile]} size={22} />
                <T variant="label" numberOfLines={1} style={styles.rowText}>
                  <T variant="label" color="text" style={styles.botName}>
                    {botName}{' '}
                  </T>
                  {event.summary}
                </T>
                {age ? (
                  <T variant="meta" color={event.status === 'failed' ? 'danger' : 'text2'}>
                    {age}
                  </T>
                ) : null}
              </Press>
            )
          })}
        </View>
        <View style={styles.actions}>
          <Pill label="Open" variant="secondary" height={36} flex onPress={() => router.push('/briefing')} />
          <Pill label="Catch up" variant="primary" height={36} flex loading={busy} onPress={() => void catchUp()} />
        </View>
      </Raised>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12 },
  card: { padding: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: -4 },
  rows: { gap: 8, paddingTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { flex: 1, minWidth: 0 },
  botName: { fontFamily: fonts.semibold },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
})
