import { useRouter } from 'expo-router'
import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { BotFace } from '@/components/bots/BotFace'
import { ApprovalCard, QuestionCard, SecretCard, SudoCard } from '@/components/chat/ActionCards'
import { RoomActions } from '@/components/rooms/RoomActions'
import { RoomFaces } from '@/components/rooms/RoomFaces'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { botLastActive } from '@/features/attention/derive'
import { formatTyped, recordDrafts, recordHeading } from '@/features/dashboard/view'
import type { DeckCard } from '@/features/inbox/deck'
import type { BotView } from '@/features/roster/view'
import { ageLabel } from '@/features/roster/derive'
import { haptic } from '@/lib/haptics'
import { faceColor } from '@/lib/hermes/faceColor'
import type { BotMeta } from '@/lib/hermes/identity'
import { answerApproval, answerQuestion, answerSecret, answerSudo } from '@/stores/actions'
import { useDashboards } from '@/stores/dashboards'
import { toast } from '@/stores/toast'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { fonts, motion, radius, tintLevel } from '@/theme/tokens'

/** Who a card is from, as the deck draws it: the bot's view when it has one, and the room members' looks for a room. */
export interface DeckContext {
  views: BotView[]
  metas: Record<string, BotMeta | undefined>
  nowS: number
}

export function cardName(card: DeckCard, context: DeckContext): string {
  return card.kind === 'room' ? card.view.name : (context.views.find(view => view.profile === card.profile)?.name ?? card.profile)
}

export function cardAge(card: DeckCard, context: DeckContext): string {
  if (card.kind === 'room') {
    return card.view.age
  }

  const view = context.views.find(candidate => candidate.profile === card.profile)

  return view ? ageLabel(botLastActive(view.row), context.nowS) : ''
}

/** One line for a card behind the top one, and for Home's Needs-you card. */
export function cardLine(card: DeckCard): string {
  if (card.kind === 'entry') {
    return card.entry.summary
  }

  if (card.kind === 'board') {
    const { title, subtitle } = card.record.row
    const head = title ? formatTyped(title, card.nowS) : card.record.view_title

    return subtitle ? `${head} · ${formatTyped(subtitle, card.nowS)}` : head
  }

  return card.view.preview
}

function cardFace(card: DeckCard, context: DeckContext): string | null {
  return card.kind === 'room' ? null : faceColor(card.profile, context.metas[card.profile])
}

function Face({ card, context, size }: { card: DeckCard; context: DeckContext; size: number }) {
  const { c } = useTheme()

  if (card.kind === 'room') {
    return <RoomFaces members={card.view.data.room.members} metas={context.metas} variant="header" ring={c.raised} />
  }

  return <BotFace name={card.profile} meta={context.metas[card.profile]} size={size} />
}

// ── the cards behind ─────────────────────────────────────────────────────────────────────────────

/** A card behind the top one: flat, in its bot's paper, showing only who and what. `depth` 1 is next, 2 the one after. */
export function BehindCard({ card, context, depth, behind }: { card: DeckCard; context: DeckContext; depth: 1 | 2; behind: number }) {
  const { scheme, neutral } = useTheme()
  const face = cardFace(card, context)
  const fill = face ? tintLevel(scheme, depth === 1 ? 'tone' : 'sheet', face) : depth === 1 ? neutral.deckNext : neutral.deckThird

  return (
    <View
      accessibilityLabel={`${cardName(card, context)}, ${depth === 1 ? 'next' : 'after that'}`}
      style={[styles.behind, { top: (behind - depth) * 38, left: depth * 14, right: depth * 14, borderRadius: depth === 1 ? 24 : 22, backgroundColor: fill }]}
    >
      {card.kind === 'room' ? <RoomFaces members={card.view.data.room.members.slice(0, 2)} metas={context.metas} variant="header" ring={fill} /> : <BotFace name={card.profile} meta={context.metas[card.profile]} size={18} />}
      <T variant="label" color={depth === 1 ? 'text' : 'text2'} style={styles.behindName}>
        {cardName(card, context)}
      </T>
      <T variant="label" color="text2" numberOfLines={1} style={styles.flex}>
        {cardLine(card)}
      </T>
      <T variant="meta" color="text2" style={styles.behindAge}>
        {cardAge(card, context)}
      </T>
    </View>
  )
}

// ── the top card ─────────────────────────────────────────────────────────────────────────────────

/** The deck's top card: raised in its bot's paper, rising in when it arrives, with the one thing to do as the white pill. */
export function TopCard({ card, context }: { card: DeckCard; context: DeckContext }) {
  const face = cardFace(card, context)

  return (
    <BotTint color={face}>
      <Raised radius={radius.deck} rise style={styles.top} accessibilityLabel={`${cardName(card, context)}, top card`}>
        <View style={styles.who}>
          <Face card={card} context={context} size={28} />
          <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
            {cardName(card, context)}
          </T>
          <T variant="meta" color="text2">
            {cardAge(card, context)}
          </T>
        </View>
        <CardBody card={card} context={context} />
      </Raised>
    </BotTint>
  )
}

function CardBody({ card, context }: { card: DeckCard; context: DeckContext }) {
  const router = useRouter()

  if (card.kind === 'room') {
    const view = card.view

    return view.attention.actions.length || view.data.questions?.length ? (
      <RoomActions room={view.data.room} actions={view.attention.actions} questions={view.data.questions} framed={false} />
    ) : (
      <>
        <T variant="display">{view.preview || 'Waiting for you'}</T>
        <Pill label="Open room" variant="primary" height={46} onPress={() => router.push({ pathname: '/room/[id]', params: { id: view.id } })} />
      </>
    )
  }

  if (card.kind === 'board') {
    return <RecordBody card={card} />
  }

  const { entry } = card
  const botName = cardName(card, context)

  switch (entry.kind) {
    case 'approval':
      return <ApprovalCard framed={false} size="deck" command={entry.command ?? ''} description={entry.summary} choices={entry.choices ?? ['once', 'deny']} state="pending" onChoose={choice => answerApproval(entry, choice)} />
    case 'question':
      return <QuestionCard framed={false} size="deck" questions={entry.questions ?? []} state="pending" onAnswer={answers => answerQuestion(entry, answers)} />
    case 'secret':
      return <SecretCard framed={false} size="deck" prompt={entry.prompt ?? ''} envVar={entry.envVar ?? ''} botName={botName} state="pending" onSubmit={value => answerSecret(entry, value)} />
    case 'sudo':
      return <SudoCard framed={false} size="deck" botName={botName} state="pending" onSubmit={password => answerSudo(entry, password)} />
    default:
      return (
        <>
          <T variant="display">{entry.summary}</T>
          <Pill label="Open chat" variant="primary" height={46} onPress={() => router.push({ pathname: '/bot/[profile]', params: { profile: entry.profile } })} />
        </>
      )
  }
}

/** A dashboard record: what it is, its body and draft when the record has loaded, and the bot's button as the white pill. */
function RecordBody({ card }: { card: Extract<DeckCard, { kind: 'board' }> }) {
  const router = useRouter()
  const { c } = useTheme()
  const id = card.record.row.id
  const detail = useDashboards(state => state.records[id])
  const { row } = card.record

  useEffect(() => {
    void useDashboards.getState().loadRecord(id)
  }, [id])

  const openRecord = () => router.push({ pathname: '/bot/[profile]/record', params: { profile: card.profile, id } })
  const title = row.title ? formatTyped(row.title, card.nowS) : 'Untitled'
  const under = [row.subtitle ? formatTyped(row.subtitle, card.nowS) : '', row.meta ? formatTyped(row.meta, card.nowS) : ''].filter(Boolean).join(' · ')
  const body = detail ? recordHeading(detail).body : ''
  const draft = detail ? recordDrafts(detail)[0] : undefined
  const running = detail?.show?.running ?? null
  const button = running ? null : (detail?.show?.actions?.[0] ?? null)

  async function press(action: { id: string; label: string }) {
    const error = await useDashboards.getState().press(card.profile, id, action.id)

    if (error) {
      toast(error)
    } else {
      router.push({ pathname: '/bot/[profile]', params: { profile: card.profile } })
    }
  }

  return (
    <>
      <View style={styles.titles}>
        <T variant="display">{title}</T>
        <T variant="secondary" color="text2">
          {under || card.record.view_title}
        </T>
      </View>
      {body ? (
        <T variant="body" color="text2" style={styles.quote} numberOfLines={6}>
          {body}
        </T>
      ) : null}
      {draft ? (
        <View style={[styles.draft, { backgroundColor: c.pressedIn }]}>
          <View style={styles.draftHead}>
            <T variant="label" color="text2" style={styles.flex} numberOfLines={1}>
              {draft.heading}
            </T>
            <Press accessibilityRole="button" accessibilityLabel={`Edit ${draft.field.label}`} hitSlop={10} onPress={openRecord}>
              <T variant="label" style={styles.edit}>
                Edit
              </T>
            </Press>
          </View>
          <T variant="body" style={styles.quote} numberOfLines={8}>
            {draft.text}
          </T>
        </View>
      ) : null}
      <View style={styles.buttons}>
        {button ? <Pill label={button.label} variant="primary" height={46} flex onPress={() => void press(button)} /> : null}
        <Pill label="Open" variant={button || running ? 'secondary' : 'primary'} height={46} flex={!button} onPress={openRecord} />
      </View>
    </>
  )
}

// ── swiping ──────────────────────────────────────────────────────────────────────────────────────

interface SwipeProps {
  children: ReactNode
  /** Swiped past the threshold (or flung) to the right or left; the card has left the screen. */
  onSwipe: (direction: 'right' | 'left') => void
  /** Swipe left springs the card back instead of sending it away (muting asks until when first). */
  returnLeft?: boolean
  enabled: boolean
}

/** A card let go short of the threshold eases back, with no overshoot. */
const BACK = { duration: 200, easing: Easing.out(Easing.cubic) }

/** The top card follows your finger sideways, tilting a little; past 30% of the width (or a fling) it goes. */
export function SwipeCard({ children, onSwipe, returnLeft, enabled }: SwipeProps) {
  const { width } = useWindowDimensions()
  const x = useSharedValue(0)
  const side = useSharedValue(0)
  const threshold = width * 0.3

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate(event => {
      x.set(event.translationX)
      const now = Math.abs(event.translationX) > threshold ? Math.sign(event.translationX) : 0

      if (now !== side.get()) {
        side.set(now)

        if (now !== 0) {
          runOnJS(haptic)('tick')
        }
      }
    })
    .onEnd(event => {
      const fling = Math.abs(event.velocityX) > motion.flingClose
      const direction = Math.abs(x.get()) > threshold || fling ? Math.sign(fling ? event.velocityX : x.get()) : 0
      side.set(0)

      if (direction === 0) {
        x.set(withTiming(0, BACK))

        return
      }

      const name = direction > 0 ? 'right' : 'left'

      if (name === 'left' && returnLeft) {
        x.set(withTiming(0, BACK))
        runOnJS(onSwipe)(name)

        return
      }

      x.set(
        withTiming(direction * width * 1.3, { duration: 200 }, finished => {
          if (finished) {
            runOnJS(onSwipe)(name)
          }
        }),
      )
    })

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { rotate: `${(x.get() / width) * 6}deg` }] }))

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  behind: { position: 'absolute', height: 110, paddingTop: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  behindName: { fontFamily: fonts.semibold },
  behindAge: { lineHeight: 18 },
  top: { padding: 18, gap: 14 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titles: { gap: 2 },
  quote: { lineHeight: 22 },
  draft: { borderRadius: radius.block, padding: 14, gap: 8 },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  edit: { fontFamily: fonts.medium },
  buttons: { flexDirection: 'row', gap: 8, paddingTop: 2 },
})
