import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { CallQuestionCard, useCanJoin, useQuestionLeft } from '@/components/phone/CallQuestion'
import { LiveLines, LiveStatus, LiveTray } from '@/components/phone/LiveCall'
import { PhoneHeader } from '@/components/phone/PhoneHeader'
import { Sep } from '@/components/phone/parts'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { timeLabel } from '@/features/dashboard/view'
import { answeredBy, callLine, clock, duringCall, formatNumber, recorded, transcriptLines, whoHasLine } from '@/features/phone/view'
import { useNow } from '@/lib/useNow'
import { useBotView } from '@/stores/bots'
import { useListen } from '@/stores/listen'
import { startPhonePoll, usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

/** Lines of the transcript shown before "Show all". */
const FIRST = 8
/** The newest lines shown while the call is on the line. */
const LIVE_LINES = 6
const ON_THE_LINE = ['dialing', 'ringing', 'live']

/**
 * One call. While it is on the line: who has it, what it waits on you for (raised), its newest lines, and the tray to listen
 * in, join, take over and hand back. Once it is over, its report: what it came to, what they said for each of the brief's
 * fields, your answers and what is still open, and the transcript when transcripts are on.
 *
 * `join=1` (from a card's or a push's "Join the call") listens in and takes the call over as soon as it is open.
 */
export default function ErrandCallScreen() {
  const { profile, errand: errandId, call: callId, join } = useLocalSearchParams<{ profile: string; errand: string; call: string; join?: string }>()
  const router = useRouter()
  const errand = usePhone(state => state.errands[errandId])
  const name = usePhone(state => state.settings?.name ?? '')
  const view = useBotView(profile)
  const { c } = useTheme()
  const nowS = useNow()
  const [all, setAll] = useState(false)
  const call = errand?.calls.find(candidate => candidate.id === callId)
  const back = errandId ? ({ pathname: '/bot/[profile]/errand', params: { profile, id: errandId } } as const) : ({ pathname: '/bot/[profile]', params: { profile } } as const)
  const onLine = !!call && ON_THE_LINE.includes(call.status)
  const snap = useListen(state => (state.errandId === errandId && state.callId === callId ? state.snap : null))
  const canJoin = useCanJoin(call)
  const left = useQuestionLeft(call)
  const joined = useRef(false)

  useEffect(() => {
    void usePhone.getState().loadErrand(errandId)
  }, [errandId])

  // While the call is on the line, read it every few seconds.
  useEffect(() => (onLine ? startPhonePoll() : undefined), [onLine])

  const listen = (asJoin: boolean) => {
    const problem = useListen.getState().start(errandId, callId, { join: asJoin })

    if (problem) {
      toast(problem)
    }
  }

  // "Join the call" from a card or a push: once the call is known to be on the line.
  useEffect(() => {
    if (join === '1' && canJoin && !joined.current) {
      joined.current = true
      listen(true)
      router.setParams({ join: undefined })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join, canJoin])

  // Leaving the screen stops listening (handing the call back first if you have it).
  useEffect(
    () => () => {
      const state = useListen.getState()

      if (state.errandId === errandId && state.callId === callId) {
        state.leave()
      }
    },
    [errandId, callId],
  )

  if (!errand || !call) {
    return (
      <BotPaper profile={profile}>
        <Screen edges={['top', 'bottom']}>
          <PhoneHeader profile={profile} title="Phone call" fallback={back} />
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        </Screen>
      </BotPaper>
    )
  }

  if (onLine) {
    const lines = transcriptLines(snap?.lines.length ? { name: call.name, transcript: snap.lines } : call, name).slice(-LIVE_LINES)
    const listening = !!snap && snap.phase !== 'ended'
    const mode = listening ? snap.mode : call.mode
    const length = call.started !== null && call.status === 'live' ? clock(nowS - call.started) : ''
    const asking = left !== null && left > 0
    const place = errand.calls.length > 1 ? ` · call ${errand.calls.indexOf(call) + 1} of ${errand.calls.length}` : ''

    return (
      <BotPaper profile={profile}>
        <Screen edges={['top']}>
          <PhoneHeader profile={profile} title={call.name} status={`${errand.brief.title}${place}`} fallback={back} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.titles}>
              <T variant="title" style={styles.headline}>
                {call.status === 'live' ? `On the line${length ? ` · ${length}` : ''}` : call.status === 'ringing' ? 'Ringing…' : 'Dialing…'}
              </T>
              {call.status === 'live' ? <LiveStatus text={whoHasLine(mode, listening)} busy={listening && (snap.joining || snap.mode === 'handover')} /> : null}
              {snap?.note ? (
                <T variant="secondary" color="text2">
                  {snap.note}
                </T>
              ) : null}
            </View>
            {call.question ? <CallQuestionCard errand={errand} call={call} meta={view?.meta} onJoin={() => listen(true)} /> : null}
            <LiveLines lines={lines} />
          </ScrollView>
          <LiveTray
            snap={snap}
            canListen={canJoin}
            quiet={asking}
            onListen={() => listen(false)}
            onJoin={() => listen(true)}
            onHangUp={() => {
              void usePhone
                .getState()
                .hangUp(errandId, callId)
                .then(error => error && toast(error))
            }}
          />
        </Screen>
      </BotPaper>
    )
  }

  const line = callLine(call, nowS)
  const outcome = line.status.split(' · ')[0] ?? ''
  const length = call.started !== null && call.ended !== null ? clock(call.ended - call.started) : ''
  const under = [call.started !== null ? timeLabel(call.started, nowS) : '', length, formatNumber(call.number), answeredBy(call)].filter(Boolean).join(' · ')
  const fields = recorded(errand.brief.record, call).filter(field => field.value)
  const during = call.status === 'done' ? duringCall(call) : []
  const lines = transcriptLines(call, name)
  const shown = all ? lines : lines.slice(0, FIRST)
  const place = errand.calls.length > 1 ? ` · call ${errand.calls.indexOf(call) + 1} of ${errand.calls.length}` : ''

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <PhoneHeader profile={profile} title={call.name} status={`${errand.brief.title}${place}`} fallback={back} />
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.titles}>
            <T variant="title" style={styles.headline}>
              {outcome.slice(0, 1).toUpperCase()}
              {outcome.slice(1)}
            </T>
            {under ? (
              <T variant="secondary" color="text2" style={styles.tabular}>
                {under}
              </T>
            ) : null}
            {call.error && call.status !== 'done' ? (
              <T variant="secondary" color="text2">
                {call.error}
              </T>
            ) : null}
          </View>

          {fields.length ? (
            <View>
              <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
                What they said
              </T>
              <View style={[styles.box, { backgroundColor: c.sheet }]}>
                {fields.map((field, index) => (
                  <View key={field.key}>
                    {index ? <Sep inset={16} /> : null}
                    <View style={styles.field}>
                      <T variant="body" color="text2" style={styles.flex}>
                        {field.label}
                      </T>
                      <T variant="body" style={styles.value}>
                        {field.value}
                      </T>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {during.length ? (
            <View>
              <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
                During the call
              </T>
              <View style={[styles.box, { backgroundColor: c.sheet }]}>
                {during.map((row, index) => (
                  <View key={`${row.label}-${index}`}>
                    {index ? <Sep inset={16} /> : null}
                    <View style={styles.during}>
                      <T variant="label" color="text2">
                        {row.label}
                      </T>
                      <T variant="body" color={row.quiet ? 'text2' : 'text'}>
                        {row.text}
                      </T>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {lines.length ? (
            <View>
              <View style={styles.transcriptHead}>
                <T variant="label" color="text2" style={styles.flex} accessibilityRole="header">
                  Transcript
                </T>
                <T variant="meta" color="text2">
                  kept 30 days on your server
                </T>
              </View>
              <View style={[styles.box, styles.transcript, { backgroundColor: c.sheet }]}>
                {shown.map((entry, index) => (
                  <View key={index} style={styles.tight}>
                    {entry.kind === 'quiet' ? (
                      <T variant="label" color="text2" style={styles.tabular}>
                        {entry.at} · {entry.text}
                      </T>
                    ) : (
                      <>
                        <T variant="meta" color="text2" style={styles.tabular}>
                          <T variant="meta" color={entry.kind === 'them' ? 'text' : 'text2'} style={styles.semibold}>
                            {entry.who}
                          </T>
                          {' · '}
                          {entry.at}
                        </T>
                        <T variant="body" style={styles.loose}>
                          {entry.text}
                        </T>
                      </>
                    )}
                  </View>
                ))}
                {lines.length > FIRST && !all ? <Pill label={`Show all ${lines.length} lines`} height={36} onPress={() => setAll(true)} style={styles.more} /> : null}
              </View>
            </View>
          ) : call.status === 'done' ? (
            <T variant="label" color="text2" style={styles.caption}>
              No transcript: transcripts are off, or nothing was said.
            </T>
          ) : null}
        </ScrollView>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24, gap: 16 },
  titles: { paddingHorizontal: 4, gap: 2 },
  headline: { fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  tabular: { fontVariant: ['tabular-nums'] },
  caption: { marginHorizontal: 4, marginBottom: 8 },
  box: { borderRadius: 20, overflow: 'hidden' },
  field: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44, paddingVertical: 11, paddingHorizontal: 16 },
  value: { maxWidth: '58%', textAlign: 'right' },
  during: { gap: 2, paddingVertical: 12, paddingHorizontal: 16 },
  transcriptHead: { flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 4, marginBottom: 8 },
  transcript: { paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  tight: { gap: 2 },
  loose: { lineHeight: 22 },
  semibold: { fontFamily: fonts.semibold },
  more: { alignSelf: 'flex-start' },
})
