import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { BehindCard, SwipeCard, TopCard, type DeckContext } from '@/components/inbox/Deck'
import { MuteSheet } from '@/components/dashboard/MuteSheet'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { formatTyped, untilLabel } from '@/features/dashboard/view'
import { leftLabel, orderDeck, startAt, turn, type DeckCard } from '@/features/inbox/deck'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useDashboards } from '@/stores/dashboards'
import { useDeck } from '@/stores/deck'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * Needs you as a deck: one card at a time, everything answerable right on it. Swipe up for the next card and down for the
 * one before, or tap a card behind to bring it up. A dashboard record swipes right when done and left to mute it until
 * later; anything else swipes either way to look at it later (it goes to the back).
 */
export default function Inbox() {
  const { c } = useTheme()
  // `start`: the card a row on Home was showing, which comes up first.
  const { start } = useLocalSearchParams<{ start?: string }>()
  const { cards } = useDeck()
  const views = useBotViews({ includeHidden: true })
  const metas = useBotMetas()
  const nowS = useNow()
  // Cards skipped for now (to the back, in order), and records swiped done that the server has not dropped yet.
  const [skipped, setSkipped] = useState<string[]>(() => startAt(cards, start))
  // How often the deck turned, so a card that comes round again arrives fresh.
  const [turns, setTurns] = useState(0)
  const [gone, setGone] = useState<string[]>([])
  // The page scrolls only when the card is taller than the screen (or the keyboard is up); swiping up and down waits then.
  const [frame, setFrame] = useState({ view: 0, content: 0 })
  const scrolls = frame.content > frame.view + 1
  const [muting, setMuting] = useState<Extract<DeckCard, { kind: 'board' }> | null>(null)
  const context = useMemo<DeckContext>(() => ({ views, metas, nowS }), [views, metas, nowS])

  const deck = useMemo(() => orderDeck(cards.filter(card => !gone.includes(card.key)), skipped), [cards, gone, skipped])
  const [top, next, third] = deck
  const behind = next ? (third ? 2 : 1) : 0
  const botName = (profile: string) => views.find(view => view.profile === profile)?.name ?? profile

  async function markDone(card: Extract<DeckCard, { kind: 'board' }>) {
    const { profile } = card
    const id = card.record.row.id
    const forget = () => setGone(keys => keys.filter(key => key !== card.key))
    setGone(keys => [...keys, card.key])
    const error = await useDashboards.getState().setClosed(profile, id, true)

    if (error) {
      forget()
      toast(error)
    } else {
      toast('Marked done', {
        label: 'Undo',
        run: () => {
          forget()
          void useDashboards.getState().setClosed(profile, id, false).then(failed => failed && toast(failed))
        },
      })
    }
  }

  async function mute(card: Extract<DeckCard, { kind: 'board' }>, until: number) {
    const { profile } = card
    const id = card.record.row.id
    const error = await useDashboards.getState().mute(profile, id, until)

    if (error) {
      toast(error)
    } else {
      toast(`Muted until ${untilLabel(until, nowS)}`, { label: 'Undo', run: () => void useDashboards.getState().mute(profile, id, null) })
    }
  }

  function onTurn(way: 'next' | 'previous', by = 1) {
    setSkipped(turn(deck, way, by))
    setTurns(count => count + 1)
  }

  function onSwipe(card: DeckCard, direction: 'right' | 'left') {
    if (card.kind !== 'board') {
      onTurn('next')
    } else if (direction === 'right') {
      void markDone(card)
    } else {
      setMuting(card)
    }
  }

  const isRecord = top?.kind === 'board'
  const turnable = deck.length > 1
  // A prompt or a room can only be put off for later, which means nothing when it is the only card.
  const sideways = !!top && (isRecord || turnable)
  const upDown = turnable && !scrolls

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Needs you" subtitle={leftLabel(deck.length)} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrolls}
        onLayout={event => {
          const view = event.nativeEvent.layout.height
          setFrame(current => (current.view === view ? current : { ...current, view }))
        }}
        onContentSizeChange={(_, content) => setFrame(current => (current.content === content ? current : { ...current, content }))}
      >
        <View style={styles.above} />
        {top ? (
          <>
            <View style={[styles.deck, { paddingTop: behind * 38 }]}>
              {third ? <BehindCard card={third} context={context} depth={2} behind={behind} onPress={() => onTurn('next', 2)} /> : null}
              {next ? <BehindCard card={next} context={context} depth={1} behind={behind} onPress={() => onTurn('next')} /> : null}
              {/* Keyed by what is on top and how often the deck turned, so a card that comes round again arrives fresh. */}
              <SwipeCard
                key={`${top.key}#${turns}`}
                sideways={sideways}
                upDown={upDown}
                returnLeft={isRecord}
                onSwipe={direction => onSwipe(top, direction)}
                onTurn={way => onTurn(way)}
              >
                <TopCard card={top} context={context} />
              </SwipeCard>
            </View>
            {sideways ? (
              isRecord ? (
                <View style={styles.hint} accessibilityLabel={`Swipe right when done, left to mute${upDown ? ', up for the next' : ''}`}>
                  <View style={styles.hintSide}>
                    <Feather name="arrow-left" size={16} color={c.text2} />
                    <T variant="label" color="text2">
                      Mute
                    </T>
                  </View>
                  {upDown ? (
                    <View style={styles.hintSide}>
                      <Feather name="arrow-up" size={16} color={c.text2} />
                      <T variant="label" color="text2">
                        Next
                      </T>
                    </View>
                  ) : null}
                  <View style={styles.hintSide}>
                    <T variant="label" color="text2">
                      Done
                    </T>
                    <Feather name="arrow-right" size={16} color={c.text2} />
                  </View>
                </View>
              ) : (
                <View style={[styles.hint, styles.hintCenter]}>
                  <T variant="label" color="text2">
                    {upDown ? 'Swipe up for the next one' : 'Swipe to look at it later'}
                  </T>
                </View>
              )
            ) : null}
          </>
        ) : (
          <View style={styles.empty}>
            <T variant="heading">Nothing needs you</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              When a bot needs an approval, an answer or a secret, or its dashboard holds something for you, it shows up here.
            </T>
          </View>
        )}
        <View style={styles.below} />
      </ScrollView>
      <MuteSheet
        title={muting ? (muting.record.row.title ? formatTyped(muting.record.row.title, muting.nowS) : 'This record') : null}
        botName={muting ? botName(muting.profile) : ''}
        nowS={nowS}
        onClose={() => setMuting(null)}
        onPick={until => {
          const target = muting
          setMuting(null)

          if (target) {
            void mute(target, until)
          }
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, paddingBottom: 24 },
  above: { flex: 1, minHeight: 22 },
  below: { flex: 1.4, minHeight: 16 },
  // Above the hint, so a card swiped down passes over it.
  deck: { marginHorizontal: 16, zIndex: 1 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginHorizontal: 28 },
  hintCenter: { justifyContent: 'center' },
  hintSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { alignItems: 'center', gap: 6, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
})
