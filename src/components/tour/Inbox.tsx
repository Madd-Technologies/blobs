import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { SwipeCard } from '@/components/inbox/Deck'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import { CROWD, crowdColor, type CrowdId } from '@/features/tour/crowd'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, tintLevel } from '@/theme/tokens'

import { CrowdFace, usePagerHold } from './kit'

interface Card {
  id: CrowdId
  ask: string
  detail: string
  mono?: boolean
  age: string
}

const CARDS: Card[] = [
  { id: 'courier', ask: 'Run this command?', detail: 'git push --force-with-lease origin main', mono: true, age: '2m' },
  { id: 'scout', ask: 'Which hosting plan?', detail: 'Starter, Team or Business', age: '9m' },
  { id: 'scribe', ask: 'Send the release notes?', detail: 'docs/CHANGES.md is ready to go', age: '25m' },
]

/** How far each card behind the top one shows above it. */
const PEEK = 34
/** Once everything is handled, the deck deals itself again after this long (ms), so the scene can be played again. */
const DEAL_AGAIN_MS = 2600

/** A card waiting behind the top one: flat, in its bot's paper, only who and what. */
function Behind({ card, depth, behind }: { card: Card; depth: 1 | 2; behind: number }) {
  const { scheme } = useTheme()

  return (
    <View style={[styles.behind, { top: (behind - depth) * PEEK, left: depth * 14, right: depth * 14, borderRadius: depth === 1 ? 24 : 22, backgroundColor: tintLevel(scheme, depth === 1 ? 'tone' : 'sheet', crowdColor(card.id)) }]}>
      <CrowdFace id={card.id} size={18} />
      <T variant="label" color={depth === 1 ? 'text' : 'text2'} style={styles.bold}>
        {CROWD[card.id].name}
      </T>
      <T variant="label" color="text2" numberOfLines={1} style={styles.flex}>
        {card.ask}
      </T>
    </View>
  )
}

/** The top card: raised in its bot's paper, rising in when it arrives. */
function Top({ card }: { card: Card }) {
  return (
    <BotTint color={crowdColor(card.id)}>
      <Raised radius={radius.deck} rise style={styles.top}>
        <View style={styles.who}>
          <CrowdFace id={card.id} size={28} motion="needs" />
          <T variant="rowTitle" style={styles.flex}>
            {CROWD[card.id].name}
          </T>
          <T variant="meta" color="text2">
            {card.age}
          </T>
        </View>
        <T variant="display">{card.ask}</T>
        <T variant={card.mono ? 'mono' : 'secondary'} color="text2" numberOfLines={1}>
          {card.detail}
        </T>
      </Raised>
    </BotTint>
  )
}

/**
 * Needs you in miniature: three bots each waiting on something, as a deck. Swipe the top card away (the real swipe, with its
 * haptic at the threshold) and the next rises; it nudges sideways now and then until you do. Clear them all and the three
 * hop for joy, then the deck deals itself again.
 */
export function Inbox({ active }: { active: boolean }) {
  const reduced = useReducedMotion()
  const hold = usePagerHold()
  const [done, setDone] = useState(0)
  const [cheer, setCheer] = useState(0)
  const [was, setWas] = useState(active)
  const nudge = useSharedValue(0)
  const left = CARDS.slice(done)
  const behind = Math.min(2, left.length - 1)
  const [top, next, after] = left

  if (was !== active) {
    setWas(active)
    setDone(0)
  }

  // Until the first swipe, the top card nudges to the right now and then: it can be swiped.
  useEffect(() => {
    if (!active || reduced || done > 0) {
      return
    }

    nudge.set(withRepeat(withSequence(withDelay(1800, withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) })), withTiming(0, { duration: 420, easing: Easing.out(Easing.back(2)) })), -1, false))

    return () => {
      cancelAnimation(nudge)
      nudge.set(withTiming(0, { duration: 150 }))
    }
  }, [active, reduced, done, nudge])

  // All handled: the faces cheer, then the deck deals again.
  useEffect(() => {
    if (done < CARDS.length) {
      return
    }

    const timers = [setTimeout(() => setCheer(count => count + 1), 250), setTimeout(() => setDone(0), DEAL_AGAIN_MS)]

    return () => timers.forEach(clearTimeout)
  }, [done])

  const nudging = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.get() * 18 }, { rotate: `${nudge.get() * 1.2}deg` }] }))
  const count = left.length

  return (
    <View style={styles.fill}>
      <View style={styles.head}>
        {count ? <AttentionDot /> : <FeatherCheck />}
        <T variant="heading">{count ? `${count} ${count === 1 ? 'thing needs' : 'things need'} you` : 'Nothing needs you'}</T>
      </View>

      <View style={styles.deck}>
        {top ? (
          <>
            {after && behind === 2 ? <Behind card={after} depth={2} behind={behind} /> : null}
            {next ? <Behind card={next} depth={1} behind={behind} /> : null}
            <View
              style={{ marginTop: behind * PEEK }}
              onTouchStart={() => hold(true)}
              onTouchEnd={() => hold(false)}
              onTouchCancel={() => hold(false)}
            >
              <Animated.View style={nudging}>
                <SwipeCard
                  key={top.id}
                  sideways={active}
                  onSwipe={() => {
                    hold(false)
                    setDone(count => count + 1)
                  }}
                >
                  <Top card={top} />
                </SwipeCard>
              </Animated.View>
            </View>
          </>
        ) : (
          <View style={styles.cleared}>
            {CARDS.map((card, index) => (
              <Cheer key={card.id} id={card.id} index={index} cheer={cheer} />
            ))}
          </View>
        )}
      </View>

      <T variant="label" color="text2" style={styles.hint}>
        {count ? 'Swipe a card away once it’s handled' : 'All caught up'}
      </T>
    </View>
  )
}

/** A face that hops for joy (twice, one after the other) each time `cheer` goes up. */
function Cheer({ id, index, cheer }: { id: CrowdId; index: number; cheer: number }) {
  const reduced = useReducedMotion()
  const hop = useSharedValue(0)

  useEffect(() => {
    if (cheer < 1 || reduced) {
      return
    }

    const once = withSequence(withTiming(1, { duration: 170, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }))
    hop.set(withDelay(index * 90, withSequence(once, withDelay(60, once))))
  }, [cheer, index, reduced, hop])

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -hop.get() * 18 }] }))

  return (
    <Animated.View style={style}>
      <CrowdFace id={id} size={60} motion="idle" poke={cheer} />
    </Animated.View>
  )
}

function FeatherCheck() {
  const { c } = useTheme()

  return <Feather name="check" size={16} color={c.text2} />
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center', gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  bold: { fontFamily: fonts.semibold },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  deck: { minHeight: 236, justifyContent: 'flex-start' },
  behind: { position: 'absolute', height: 110, paddingTop: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  top: { padding: 18, gap: 8 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  cleared: { flex: 1, minHeight: 236, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  hint: { textAlign: 'center' },
})
