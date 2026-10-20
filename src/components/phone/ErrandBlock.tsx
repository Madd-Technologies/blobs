import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { T } from '@/components/ui/T'
import { activeCall, barLine, callLine, callLines, inMotion, openQuestion, yourAnswers } from '@/features/phone/view'
import type { BotMeta } from '@/lib/hermes/identity'
import type { Errand } from '@/lib/hermes/phone'
import { useNowMs } from '@/lib/useNow'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

import { CallQuestionCard } from './CallQuestion'
import { RequestCard } from './RequestCard'
import { CallLineRow, LineMark } from './parts'

const plural = (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`

function Quiet({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  const { c } = useTheme()

  return (
    <View style={styles.quiet}>
      <Feather name={icon} size={14} color={c.text2} style={styles.quietIcon} />
      <T variant="label" color="text2" style={styles.flex}>
        {text}
      </T>
    </View>
  )
}

/**
 * A phone errand where it sits in its chat: the request card while it waits for your OK, then a quiet line for your
 * decision, the errand's call lines (tap one for its report), any answer you gave, and a live call's question raised.
 */
export function ErrandBlock({ errand, botName, meta }: { errand: Errand; botName: string; meta: BotMeta | undefined }) {
  const router = useRouter()
  const settings = usePhone(state => state.settings)
  const moving = inMotion(errand)
  // Live lines count up each second while a call is on (even a stopped errand's last one); settled ones need no clock.
  const nowS = useNowMs(moving, 1000) / 1000
  const { brief } = errand

  if (errand.status === 'pending') {
    return <RequestCard errand={errand} botName={botName} meta={meta} settings={settings} nowS={nowS} />
  }

  if (errand.status === 'declined') {
    return <Quiet icon="x" text={`You declined ${plural(brief.calls.length)} · ${brief.title}`} />
  }

  if (errand.status === 'expired') {
    return <Quiet icon="clock" text={`The request for ${plural(brief.calls.length)} expired · ${brief.title}`} />
  }

  const openErrand = () => router.push({ pathname: '/bot/[profile]/errand', params: { profile: errand.profile, id: errand.id } })
  const openCall = (callId: string) => router.push({ pathname: '/bot/[profile]/errand-call', params: { profile: errand.profile, errand: errand.id, call: callId } })
  const answered = errand.calls.flatMap(call => yourAnswers(call).map(answer => ({ call, answer })))
  const asking = errand.calls.filter(call => openQuestion(call, nowS))

  return (
    <View style={styles.block}>
      <Quiet icon="check" text={`You approved ${plural(errand.calls.length)} · ${brief.title}`} />
      {answered.map(({ call, answer }, index) => (
        <Quiet key={`${call.id}-${index}`} icon="check" text={`You answered ${call.name}: “${answer.answer}”`} />
      ))}
      <View style={styles.lines}>
        <Press accessibilityRole="link" accessibilityLabel={`Phone errand, ${brief.title}`} onPress={openErrand} style={styles.head}>
          <PhoneHead title={brief.title} />
        </Press>
        {callLines(errand, nowS).map(({ call, line }) => (
          <CallLineRow key={call.id} name={call.name} line={line} onPress={line.live || call.status === 'waiting' ? openErrand : () => openCall(call.id)} />
        ))}
        {errand.problem && moving ? (
          <T variant="label" color="text2">
            {errand.problem}
          </T>
        ) : null}
      </View>
      {asking.map(call => (
        <CallQuestionCard key={call.id} errand={errand} call={call} meta={meta} />
      ))}
    </View>
  )
}

function PhoneHead({ title }: { title: string }) {
  const { c } = useTheme()

  return (
    <>
      <Feather name="phone" size={14} color={c.text2} />
      <T variant="label" color="text2" numberOfLines={1} style={styles.headText}>
        Phone errand · {title}
      </T>
      <Feather name="chevron-right" size={13} color={c.text2} />
    </>
  )
}

/**
 * The call on the line, in the composer tray: who, what it is doing and which call it is, a ⋯ to stop the whole errand, and
 * Hang up (pressed in: it ends only this call and the errand goes on to the next).
 */
export function CallTrayRow({ errand }: { errand: Errand }) {
  const router = useRouter()
  const { c } = useTheme()
  const nowS = useNowMs(true, 1000) / 1000
  const [stopping, setStopping] = useState(false)
  const [busy, setBusy] = useState(false)
  const call = activeCall(errand)

  if (!call) {
    return null
  }

  const line = callLine(call, nowS)

  async function hangUp() {
    if (!call) {
      return
    }

    setBusy(true)
    const error = await usePhone.getState().hangUp(errand.id, call.id)
    setBusy(false)

    if (error) {
      toast(error)
    }
  }

  async function stop() {
    setStopping(false)
    const error = await usePhone.getState().cancel(errand.id)

    if (error) {
      toast(error)
    }
  }

  return (
    <View style={styles.tray}>
      <View style={[styles.trayMark, { backgroundColor: c.tone }]}>
        <LineMark icon={line.icon} live />
      </View>
      <Press accessibilityRole="button" accessibilityLabel={`Open the call with ${call.name}`} onPress={() => router.push({ pathname: '/bot/[profile]/errand', params: { profile: errand.profile, id: errand.id } })} style={styles.trayText}>
        <T variant="bodyMedium" numberOfLines={1}>
          {call.name}
        </T>
        <T variant="label" color="text2" numberOfLines={1} style={styles.tabular}>
          {barLine(errand, call, nowS)}
        </T>
      </Press>
      <IconCircle icon="more-horizontal" label="More: stop the errand" diameter={40} onPress={() => setStopping(true)} />
      <Pill label={call.hangup ? 'Hanging up' : 'Hang up'} icon="phone-off" height={44} disabled={call.hangup} loading={busy} onPress={() => void hangUp()} style={styles.hangUp} />
      <ConfirmSheet
        visible={stopping}
        title="Stop this errand?"
        message={`${call.name} is hung up on, and the calls not made yet aren’t made.`}
        confirmLabel="Stop the errand"
        destructive
        onClose={() => setStopping(false)}
        onConfirm={() => void stop()}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  block: { gap: 10 },
  quiet: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  quietIcon: { marginTop: 2 },
  lines: { gap: 6 },
  head: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, maxWidth: '100%' },
  headText: { flexShrink: 1 },
  tray: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, minHeight: 48 },
  trayMark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  trayText: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  tabular: { fontVariant: ['tabular-nums'] },
  hangUp: { paddingHorizontal: 14 },
})
