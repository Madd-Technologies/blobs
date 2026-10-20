import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { CallQuestionCard } from '@/components/phone/CallQuestion'
import { CallTrayRow } from '@/components/phone/ErrandBlock'
import { askBotAbout } from '@/components/phone/PhoneDeck'
import { PhoneHeader } from '@/components/phone/PhoneHeader'
import { RequestCard } from '@/components/phone/RequestCard'
import { CallLineRow, LineMark, NeedsDot, Sep } from '@/components/phone/parts'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { timeLabel } from '@/features/dashboard/view'
import { activeCall, callLine, callLines, callSummary, compare, headline, inMotion, openQuestion, resultsLine, shortName, theyAsked } from '@/features/phone/view'
import type { Errand } from '@/lib/hermes/phone'
import { useNowMs } from '@/lib/useNow'
import { useBotView } from '@/stores/bots'
import { startPhonePoll, usePhone } from '@/stores/phone'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/**
 * One phone errand. Waiting for your OK: the whole request card. Calling: each call's line, a live question raised, and the
 * call on the line in a tray. Finished: what the calls came to, anything they asked of you, the answers side by side, and
 * each call (tap for its report).
 */
export default function ErrandScreen() {
  const { profile, id } = useLocalSearchParams<{ profile: string; id: string }>()
  const errand = usePhone(state => state.errands[id])
  const settings = usePhone(state => state.settings)
  const view = useBotView(profile)
  const botName = view?.name ?? profile
  // Live lines count each second while calls are being made; a request waiting for your OK needs no clock.
  const nowS = useNowMs(!!errand && inMotion(errand), 1000) / 1000
  const back = { pathname: '/bot/[profile]', params: { profile } } as const

  useEffect(() => {
    void usePhone.getState().loadErrand(id)
    void usePhone.getState().loadSettings()

    return startPhonePoll()
  }, [id])

  if (!errand) {
    return (
      <BotPaper profile={profile}>
        <Screen edges={['top', 'bottom']}>
          <PhoneHeader profile={profile} title="Phone errand" fallback={back} />
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        </Screen>
      </BotPaper>
    )
  }

  const status =
    errand.status === 'pending' ? (
      <>
        <NeedsDot /> Waiting for you
      </>
    ) : (
      `Phone errand · ${timeLabel(errand.created, nowS)}`
    )
  const calling = errand.status === 'running' || errand.status === 'approved'
  const live = activeCall(errand)

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <PhoneHeader profile={profile} title={errand.status === 'pending' ? botName : errand.brief.title} status={status} fallback={back} />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {errand.status === 'pending' ? (
            <RequestCard errand={errand} botName={botName} meta={view?.meta} settings={settings} nowS={nowS} />
          ) : errand.status === 'declined' || errand.status === 'expired' ? (
            <View style={styles.titles}>
              <T variant="title" style={styles.headline}>
                {errand.status === 'declined' ? 'Declined' : 'Expired'}
              </T>
              <T variant="secondary" color="text2">
                {errand.status === 'declined' ? 'Nothing was dialed.' : 'Nobody approved it within 24 hours, so nothing was dialed.'}
              </T>
            </View>
          ) : (
            <Results errand={errand} botName={botName} nowS={nowS} calling={calling} />
          )}
          {calling
            ? errand.calls
                .filter(call => openQuestion(call, nowS))
                .map(call => <CallQuestionCard key={call.id} errand={errand} call={call} meta={view?.meta} />)
            : null}
        </ScrollView>
        {live ? (
          <View style={styles.trayWrap}>
            <Raised radius={radius.tray} style={styles.tray}>
              <CallTrayRow errand={errand} />
            </Raised>
          </View>
        ) : null}
      </Screen>
    </BotPaper>
  )
}

function Results({ errand, botName, nowS, calling }: { errand: Errand; botName: string; nowS: number; calling: boolean }) {
  const router = useRouter()
  const { c } = useTheme()
  const dismissed = usePhone(state => state.dismissed.includes(errand.id))
  const asks = theyAsked(errand)
  const table = compare(errand)
  const finished = errand.calls.filter(call => !['waiting', 'dialing', 'ringing', 'live'].includes(call.status))
  const openCall = (call: string) => router.push({ pathname: '/bot/[profile]/errand-call', params: { profile: errand.profile, errand: errand.id, call } })

  return (
    <>
      <View style={styles.titles}>
        <T variant="title" style={styles.headline}>
          {headline(errand) || (calling ? 'Calling' : 'No calls made')}
        </T>
        <T variant="secondary" color="text2">
          {calling ? (errand.problem || `${finished.length} of ${errand.calls.length} done`) : resultsLine(errand)}
        </T>
      </View>

      {calling ? (
        <View style={[styles.box, styles.lines, { backgroundColor: c.sheet }]}>
          {callLines(errand, nowS).map(({ call, line }) => (
            <CallLineRow key={call.id} name={call.name} line={line} onPress={line.live || call.status === 'waiting' ? undefined : () => openCall(call.id)} />
          ))}
        </View>
      ) : null}

      {asks.length && !dismissed && !calling ? (
        <Raised radius={radius.card} style={styles.asked} accessibilityLabel="Asked of you">
          <View style={styles.askedHead}>
            <NeedsDot size={8} />
            <T variant="rowTitle" style={styles.flex}>
              {asks.length === 1 && asks[0] ? `${asks[0].call.name} asked you` : `${asks.length} calls asked you`}
            </T>
          </View>
          {asks.map(({ call, text }) => (
            <View key={call.id} style={styles.tight}>
              {asks.length > 1 ? (
                <T variant="label" color="text2">
                  {call.name}
                </T>
              ) : null}
              <T variant="body" style={styles.loose}>
                “{text}”
              </T>
            </View>
          ))}
          <T variant="label" color="text2">
            {botName} doesn’t act on what a call asks for. It’s yours to decide.
          </T>
          <View style={styles.buttons}>
            <Pill label={`Ask ${botName}`} variant="primary" height={44} flex onPress={() => askBotAbout(errand, router.push)} />
            <Pill label="Done" height={44} onPress={() => usePhone.getState().dismiss(errand.id)} />
          </View>
        </Raised>
      ) : null}

      {table.rows.length && finished.length ? (
        <View>
          <T variant="rowTitle" color="text2" style={styles.sectionHead} accessibilityRole="header">
            Side by side
          </T>
          <ScrollView horizontal={errand.calls.length > 3} showsHorizontalScrollIndicator={false} style={[styles.box, { backgroundColor: c.sheet }]} contentContainerStyle={styles.table}>
            <View style={errand.calls.length > 3 ? { width: 92 + errand.calls.length * 96 } : styles.flex}>
              <View style={styles.tableRow}>
                <View style={styles.tableLabel} />
                {errand.calls.map(call => (
                  <View key={call.id} style={styles.tableCell}>
                    <T variant="label" numberOfLines={1} style={styles.semibold}>
                      {shortName(call.name)}
                    </T>
                    <T variant="meta" color="text2" numberOfLines={1}>
                      {callLine(call, nowS).status.split(' · ')[0]}
                    </T>
                  </View>
                ))}
              </View>
              {table.rows.map(row => (
                <View key={row.label}>
                  <Sep />
                  <View style={styles.tableRow}>
                    <T variant="label" color="text2" style={styles.tableLabel}>
                      {row.label}
                    </T>
                    {row.values.map((value, index) => (
                      <T key={index} variant="label" color={value === '—' ? 'text2' : 'text'} style={[styles.tableCell, styles.tabular]}>
                        {value}
                      </T>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {finished.length && !calling ? (
        <View>
          <T variant="rowTitle" color="text2" style={styles.sectionHead} accessibilityRole="header">
            Each call
          </T>
          <View style={[styles.box, { backgroundColor: c.sheet }]}>
            {errand.calls.map((call, index) => (
              <View key={call.id}>
                {index ? <Sep inset={52} /> : null}
                <Press accessibilityRole="button" accessibilityLabel={`${call.name}, ${callSummary(call, nowS)}`} onPress={() => openCall(call.id)} style={styles.callRow}>
                  <View style={styles.callMark}>
                    <LineMark icon={callLine(call, nowS).icon} size={18} />
                  </View>
                  <View style={styles.flex}>
                    <T variant="rowTitle" numberOfLines={1}>
                      {call.name}
                    </T>
                    <T variant="label" color="text2" numberOfLines={2}>
                      {callSummary(call, nowS)}
                    </T>
                  </View>
                  <Feather name="chevron-right" size={16} color={c.text2} />
                </Press>
              </View>
            ))}
          </View>
          <T variant="label" color="text2" style={styles.footnote}>
            What each call wrote down is what they said on the call. A call never agrees to a price.
          </T>
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24, gap: 16 },
  titles: { paddingHorizontal: 4, gap: 2 },
  headline: { fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  box: { borderRadius: 20, overflow: 'hidden' },
  lines: { paddingVertical: 12, paddingHorizontal: 14, gap: 6 },
  asked: { padding: 16, gap: 10 },
  askedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tight: { gap: 2 },
  loose: { lineHeight: 22 },
  buttons: { flexDirection: 'row', gap: 8, paddingTop: 2 },
  sectionHead: { marginHorizontal: 4, marginTop: 4, marginBottom: 8 },
  table: { paddingTop: 12, paddingBottom: 4, flexGrow: 1 },
  tableRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  tableLabel: { width: 92 },
  tableCell: { flex: 1, minWidth: 0 },
  semibold: { fontFamily: fonts.semibold },
  tabular: { fontVariant: ['tabular-nums'] },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, paddingLeft: 16, paddingRight: 14 },
  callMark: { width: 24, alignItems: 'center' },
  footnote: { marginHorizontal: 4, marginTop: 8 },
  trayWrap: { paddingHorizontal: 12, paddingBottom: 8 },
  tray: { paddingVertical: 8, paddingRight: 8 },
})
