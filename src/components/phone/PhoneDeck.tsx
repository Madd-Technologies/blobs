import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { T } from '@/components/ui/T'
import type { DeckCard } from '@/features/inbox/deck'
import type { Errand } from '@/lib/hermes/phone'
import { askLine, askSummary, clock, formatNumber, isApproval, requestLine, spokenOpening, theyAsked } from '@/features/phone/view'
import { ageLabel } from '@/features/roster/derive'
import { useNowMs } from '@/lib/useNow'
import { usePhone } from '@/stores/phone'
import { useDrafts } from '@/stores/drafts'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

import { AskBody, Countdown, useCanJoin, useJoinCall, useQuestionLeft } from './CallQuestion'
import { NeedsDot, OpeningBlock } from './parts'

type PhoneCard = Extract<DeckCard, { kind: 'phone' }>

const MODE_SHORT = { quote: 'quotes only', book: 'may book', ask: 'asks or passes on a message' } as const

/**
 * "Ask <bot>": what calls asked of you goes into the bot's chat as a draft, for you to finish (the bot never acts on a call's
 * request by itself, and this keeps it your decision).
 */
export function askBotAbout(errand: Errand, push: ReturnType<typeof useRouter>['push']) {
  const lines = theyAsked(errand)
    .map(({ call, text }) => `${call.name} asked: “${text}”`)
    .join('\n')
  useDrafts.getState().set(errand.profile, `About the phone errand “${errand.brief.title}”:\n${lines}\n`)
  push({ pathname: '/bot/[profile]', params: { profile: errand.profile, ...(errand.session_id ? { chat: errand.session_id } : {}) } })
}

/** One line for a phone card behind the top one, and for Home's Needs-you sheet. */
export function phoneCardLine(card: PhoneCard): string {
  if (card.need === 'question' && card.call?.question) {
    return askSummary(card.call)
  }

  if (card.need === 'asked') {
    const [first, ...more] = theyAsked(card.errand)

    return first ? `${first.call.name} asked you: ${first.text}${more.length ? ` (and ${more.length} more)` : ''}` : card.errand.brief.title
  }

  return requestLine(card.errand)
}

export function phoneCardAge(card: PhoneCard, nowS: number): string {
  return ageLabel(card.need === 'asked' ? (card.errand.finished ?? card.errand.created) : card.errand.created, nowS) || 'now'
}

/** The top card's header for a live question: who asks, on whose call, and the minute it waits. */
export function PhoneQuestionHeader({ card, botName }: { card: PhoneCard; botName: string }) {
  const left = useQuestionLeft(card.call)
  const nowMs = useNowMs(true, 1000)
  const call = card.call
  const live = call?.started != null && call.status === 'live' ? ` · live ${clock(nowMs / 1000 - call.started)}` : ''

  return (
    <>
      <View style={styles.flex}>
        <T variant="rowTitle" numberOfLines={1}>
          {call?.name ?? 'A call'} {isApproval(call?.question) ? 'needs your OK' : 'asks'}
        </T>
        <T variant="label" color="text2" numberOfLines={1}>
          {botName}’s phone call{live}
        </T>
      </View>
      {left !== null && left > 0 ? <Countdown left={left} large /> : null}
    </>
  )
}

/** What a phone card shows on top of the deck. */
export function PhoneDeckBody({ card, botName }: { card: PhoneCard; botName: string }) {
  switch (card.need) {
    case 'question':
      return <QuestionBody card={card} />
    case 'asked':
      return <AskedBody card={card} botName={botName} />
    default:
      return <RequestBody card={card} />
  }
}

function RequestBody({ card }: { card: PhoneCard }) {
  const router = useRouter()
  const { c } = useTheme()
  const settings = usePhone(state => state.settings)
  const [busy, setBusy] = useState(false)
  const { errand } = card
  const { brief } = errand
  const opening = spokenOpening(brief, settings?.name ?? '', settings?.transcripts ?? true)
  const flagged = errand.flags.map(flag => flag.label.toLowerCase())
  const review = () => router.push({ pathname: '/bot/[profile]/errand', params: { profile: errand.profile, id: errand.id } })

  async function decline() {
    setBusy(true)
    const error = await usePhone.getState().decline(errand.id)
    setBusy(false)

    if (error) {
      toast(error)
    }
  }

  return (
    <>
      <View style={styles.titles}>
        <T variant="display">{askLine(brief.calls.length)}</T>
        <T variant="secondary" color="text2">
          {brief.title} · {MODE_SHORT[brief.mode] ?? MODE_SHORT.quote}
        </T>
      </View>
      <OpeningBlock label="They hear first" fixed={opening.fixed} own={opening.own} fill={c.pressedIn} />
      <View style={styles.calls}>
        {brief.calls.map((call, index) => (
          <View key={`${index}-${call.number}`} style={styles.callRow}>
            <T variant="secondary" numberOfLines={1} style={styles.flex}>
              {call.name}
            </T>
            <T variant="secondary" color="text2" style={styles.tabular}>
              {formatNumber(call.number)}
            </T>
          </View>
        ))}
      </View>
      {flagged.length ? (
        <View style={styles.gate}>
          <NeedsDot />
          <T variant="secondary" style={styles.flex}>
            {flagged.length === 1 ? `The ${flagged[0]} needs your tick` : `${flagged.length} facts need your tick`}
          </T>
        </View>
      ) : null}
      <View style={styles.buttons}>
        <Pill label="Review the brief" variant="primary" height={46} flex onPress={review} />
        <Pill label="Decline" height={46} loading={busy} onPress={() => void decline()} />
      </View>
    </>
  )
}

function QuestionBody({ card }: { card: PhoneCard }) {
  const router = useRouter()
  const canJoin = useCanJoin(card.call)
  const join = useJoinCall()
  const { errand, call } = card

  if (!call?.question) {
    return null
  }

  const open = () => router.push({ pathname: '/bot/[profile]/errand-call', params: { profile: errand.profile, errand: errand.id, call: call.id } })

  return (
    <>
      <AskBody errand={errand} call={call} size="deck" onJoin={canJoin ? () => join(errand, call) : undefined} />
      <View style={styles.buttons}>
        <Pill label="Open the call" height={46} onPress={open} />
      </View>
    </>
  )
}

function AskedBody({ card, botName }: { card: PhoneCard; botName: string }) {
  const router = useRouter()
  const asks = theyAsked(card.errand)
  const { errand } = card
  const [first] = asks

  const handOver = () => askBotAbout(errand, router.push)

  return (
    <>
      <View style={styles.titles}>
        <T variant="display">{asks.length === 1 && first ? `${first.call.name} asked you` : `${asks.length} calls asked you`}</T>
        <T variant="secondary" color="text2">
          {errand.brief.title}
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
        <Pill label={`Ask ${botName}`} variant="primary" height={46} flex onPress={handOver} />
        <Pill label="Done" height={46} onPress={() => usePhone.getState().dismiss(errand.id)} />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  titles: { gap: 2 },
  calls: { gap: 4 },
  callRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  tabular: { fontVariant: ['tabular-nums'] },
  gate: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { flexDirection: 'row', gap: 8, paddingTop: 2 },
  tight: { gap: 2 },
  loose: { lineHeight: 22 },
})
