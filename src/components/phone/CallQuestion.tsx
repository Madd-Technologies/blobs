import Feather from '@expo/vector-icons/Feather'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { clock, openQuestion } from '@/features/phone/view'
import { haptic } from '@/lib/haptics'
import type { BotMeta } from '@/lib/hermes/identity'
import type { Call, Errand } from '@/lib/hermes/phone'
import { useNowMs } from '@/lib/useNow'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { NeedsDot, QuestionTrack } from './parts'

/** The seconds a live call's question has left, ticking each second (by this phone's clock; the server has the last word). */
export function useQuestionLeft(call: Call | undefined): number | null {
  const waiting = !!call?.question && !call.question.answer
  const nowMs = useNowMs(waiting, 1000)

  return call ? (openQuestion(call, nowMs / 1000)?.left ?? null) : null
}

/** Sends your answer to the call; returns whether it went. */
export async function sendAnswer(errand: Errand, call: Call, text: string): Promise<boolean> {
  const error = await usePhone.getState().answer(errand.id, call.id, text.trim())

  if (error) {
    toast(error)

    return false
  }

  haptic('confirm')

  return true
}

/** The countdown beside the question: an amber dot while it waits on you. */
export function Countdown({ left, large }: { left: number; large?: boolean }) {
  return (
    <View style={styles.countdown} accessibilityLabel={`${left} seconds left to answer`}>
      <NeedsDot />
      <T variant={large ? 'rowTitle' : 'secondary'} style={styles.countdownText}>
        {clock(left)}
      </T>
    </View>
  )
}

/**
 * A live call's question, raised in the chat under the errand: who asks, the minute it waits, their words, and an answer
 * field with the white send circle. Past the minute it says what they heard instead.
 */
export function CallQuestionCard({ errand, call, meta }: { errand: Errand; call: Call; meta: BotMeta | undefined }) {
  const { c } = useTheme()
  const left = useQuestionLeft(call)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  if (left === null || !call.question) {
    return null
  }

  async function send() {
    setBusy(true)
    const went = await sendAnswer(errand, call, text)
    setBusy(false)

    if (went) {
      setText('')
    }
  }

  const over = left <= 0

  return (
    <Raised radius={radius.card} rise={`ask-${call.id}-${call.question.asked}`} style={styles.card} accessibilityLabel="Question from the call">
      <View style={styles.who}>
        <BotFace name={errand.profile} meta={meta} size={22} />
        <T variant="heading" numberOfLines={1} style={styles.flex}>
          {call.name} asks
        </T>
        {over ? null : <Countdown left={left} />}
      </View>
      <QuestionTrack left={left} />
      <T variant="reply" style={styles.question}>
        “{call.question.text}”
      </T>
      {over ? (
        <T variant="label" color="text2">
          The minute is up: they heard you’ll get back to them.
        </T>
      ) : (
        <>
          <View style={[styles.field, { backgroundColor: c.canvas }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={`Answer ${call.name}`}
              placeholderTextColor={c.text2}
              accessibilityLabel={`Answer ${call.name}`}
              returnKeyType="send"
              editable={!busy}
              onSubmitEditing={() => text.trim() && void send()}
              style={[styles.input, { color: c.text }]}
            />
            <Press accessibilityRole="button" accessibilityLabel="Send the answer" disabled={busy || !text.trim()} onPress={() => void send()} style={[styles.send, { backgroundColor: c.primary, opacity: busy || !text.trim() ? 0.4 : 1 }]}>
              <Feather name="arrow-up" size={18} color={c.onPrimary} />
            </Press>
          </View>
          <T variant="label" color="text2">
            They’re on hold for your answer. After a minute they hear you’ll get back to them.
          </T>
        </>
      )}
    </Raised>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: -4, padding: 16, gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  question: { lineHeight: 24 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countdownText: { fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingRight: 4, paddingLeft: 14, borderRadius: 26 },
  input: { flex: 1, minWidth: 0, height: 40, fontFamily: fonts.regular, fontSize: 15, padding: 0 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
