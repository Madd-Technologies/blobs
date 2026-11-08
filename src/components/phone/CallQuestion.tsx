import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { clock, isApproval, openQuestion } from '@/features/phone/view'
import { haptic } from '@/lib/haptics'
import type { BotMeta } from '@/lib/hermes/identity'
import { phoneHas, type Call, type CallReply, type Errand } from '@/lib/hermes/phone'
import { useNowMs } from '@/lib/useNow'
import { canListen } from '@/stores/listen'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { NeedsDot, QuestionTrack } from './parts'

/** The seconds a live call's question has left, ticking each second (by this phone's clock; the server has the last word). */
export function useQuestionLeft(call: Call | undefined): number | null {
  return useQuestionWait(call)?.left ?? null
}

/** The seconds left and the whole wait (a minute, three while you listen in). */
export function useQuestionWait(call: Call | undefined): { left: number; of: number } | null {
  const waiting = !!call?.question && !call.question.answer && typeof call.question.approved !== 'boolean'
  const nowMs = useNowMs(waiting, 1000)
  const open = call ? openQuestion(call, nowMs / 1000) : null

  return open ? { left: open.left, of: open.of } : null
}

/** Sends your answer to the call (pinned to its question when the server gives it an id); returns whether it went. */
export async function sendAnswer(errand: Errand, call: Call, reply: CallReply | string): Promise<boolean> {
  const body: CallReply = typeof reply === 'string' ? { text: reply.trim() } : reply
  const ask = call.question?.id
  const error = await usePhone.getState().answer(errand.id, call.id, ask ? { ...body, ask } : body)

  if (error) {
    toast(error)

    return false
  }

  haptic('approved' in body && !body.approved ? 'reject' : 'confirm')

  return true
}

/** Whether "Join the call" can be offered: the Android app, a server whose hermes-phone can be listened in on, a call on the line. */
export function useCanJoin(call: Call | undefined): boolean {
  const listen = usePhone(state => phoneHas(state.status, 'listen'))

  return listen && canListen() && call?.status === 'live'
}

/** Opens the call's own screen and joins it there (listen in, then take over). */
export function useJoinCall(): (errand: Errand, call: Call) => void {
  const router = useRouter()

  return (errand, call) => router.push({ pathname: '/bot/[profile]/errand-call', params: { profile: errand.profile, errand: errand.id, call: call.id, join: '1' } })
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

interface AskProps {
  errand: Errand
  call: Call
  /** Join the call instead of answering (shown only where joining is possible). */
  onJoin?: () => void
  /** `deck`: inside Needs you's top card, which brings its own header. */
  size?: 'card' | 'deck'
}

/**
 * What a live call waits on you for: a question (its choices as pills, or a typed answer) or an approval of something outside
 * the brief (Allow / Deny). The bar empties as the wait runs out; past it, it says what they heard. "Join the call" answers by
 * talking to them yourself.
 */
export function AskBody({ errand, call, onJoin, size = 'card' }: AskProps) {
  const { c } = useTheme()
  const wait = useQuestionWait(call)
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const question = call.question

  if (!question || !wait) {
    return null
  }

  async function send(reply: CallReply) {
    setBusy(true)
    const went = await sendAnswer(errand, call, reply)
    setBusy(false)

    if (went) {
      setText('')
    }
  }

  const over = wait.left <= 0
  const approval = isApproval(question)
  const choices = question.choices ?? []
  const free = !approval && (choices.length === 0 || typing)
  const deck = size === 'deck'

  return (
    <View style={styles.stack}>
      <QuestionTrack left={wait.left} of={wait.of} />
      {approval ? (
        <>
          <View style={[styles.block, { backgroundColor: deck ? c.pressedIn : c.canvas }]}>
            <T variant={deck ? 'display' : 'reply'} style={deck ? undefined : styles.loose}>
              {question.text}
            </T>
          </View>
          <T variant="label" color="text2">
            Outside the brief. If you allow it, the voice may agree to exactly this, and never to money.
          </T>
        </>
      ) : (
        <T variant={deck ? 'display' : 'reply'} style={deck ? undefined : styles.loose}>
          “{question.text}”
        </T>
      )}

      {over ? (
        <T variant="label" color="text2">
          Time’s up: they heard you’ll get back to them.
        </T>
      ) : (
        <>
          {approval ? (
            <View style={styles.row}>
              <Pill label="Allow" variant="primary" flex height={deck ? 46 : 44} disabled={busy} onPress={() => void send({ approved: true })} />
              <Pill label="Deny" flex height={deck ? 46 : 44} disabled={busy} onPress={() => void send({ approved: false })} />
            </View>
          ) : null}

          {!approval && choices.length ? (
            <View style={styles.choices}>
              {choices.map(choice => (
                <Pill key={choice} label={choice} height={42} wrap disabled={busy} onPress={() => void send({ choice })} />
              ))}
              {!typing ? <Pill label="Reply…" variant="ghost" onPress={() => setTyping(true)} /> : null}
            </View>
          ) : null}

          {free ? (
            <View style={[styles.field, { backgroundColor: deck ? c.pressedIn : c.canvas }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={`Answer ${call.name}`}
                placeholderTextColor={c.text2}
                accessibilityLabel={`Answer ${call.name}`}
                returnKeyType="send"
                editable={!busy}
                onSubmitEditing={() => text.trim() && void send({ text: text.trim() })}
                style={[styles.input, { color: c.text }]}
              />
              <Press
                accessibilityRole="button"
                accessibilityLabel="Send the answer"
                disabled={busy || !text.trim()}
                onPress={() => void send({ text: text.trim() })}
                style={[styles.send, { backgroundColor: c.primary, opacity: busy || !text.trim() ? 0.4 : 1 }]}
              >
                <Feather name="arrow-up" size={18} color={c.onPrimary} />
              </Press>
            </View>
          ) : null}

          {onJoin ? <Pill label="Join the call" icon="phone" variant="ghost" onPress={onJoin} style={styles.join} /> : null}

          <T variant="label" color="text2">
            They’re on a short hold. After {clock(wait.of)} they hear you’ll get back to them.
          </T>
        </>
      )}
    </View>
  )
}

/**
 * A live call's question or approval, raised: who asks, the time it waits, and what you can do about it. Used in the chat under
 * the errand, on the errand, and on the call's own screen.
 */
export function CallQuestionCard({ errand, call, meta, onJoin }: { errand: Errand; call: Call; meta: BotMeta | undefined; onJoin?: () => void }) {
  const left = useQuestionLeft(call)
  const canJoin = useCanJoin(call)
  const join = useJoinCall()

  if (left === null || !call.question) {
    return null
  }

  const approval = isApproval(call.question)

  return (
    <Raised radius={radius.card} rise={`ask-${call.id}-${call.question.asked}`} style={styles.card} accessibilityLabel={approval ? 'The call needs your OK' : 'Question from the call'}>
      <View style={styles.who}>
        <BotFace name={errand.profile} meta={meta} size={22} />
        <T variant="heading" numberOfLines={1} style={styles.flex}>
          {approval ? `${call.name} needs your OK` : `${call.name} asks`}
        </T>
        {left > 0 ? <Countdown left={left} /> : null}
      </View>
      <AskBody errand={errand} call={call} onJoin={canJoin ? (onJoin ?? (() => join(errand, call))) : undefined} />
    </Raised>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: -4, padding: 16, gap: 12 },
  stack: { gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loose: { lineHeight: 24 },
  block: { borderRadius: radius.block, padding: 12 },
  row: { flexDirection: 'row', gap: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  join: { alignSelf: 'flex-start', marginTop: -4 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countdownText: { fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingRight: 4, paddingLeft: 14, borderRadius: 26 },
  input: { flex: 1, minWidth: 0, height: 40, fontFamily: fonts.regular, fontSize: 15, padding: 0 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
})
