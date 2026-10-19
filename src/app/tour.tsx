import { useRouter } from 'expo-router'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, runOnJS, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { Ask } from '@/components/tour/Ask'
import { Inbox } from '@/components/tour/Inbox'
import { PagerHold } from '@/components/tour/kit'
import { Meet } from '@/components/tour/Meet'
import { PageDots } from '@/components/tour/PageDots'
import { Ready } from '@/components/tour/Ready'
import { Rooms } from '@/components/tour/Rooms'
import { TakeOver } from '@/components/tour/TakeOver'
import { Work } from '@/components/tour/Work'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { T } from '@/components/ui/T'
import { haptic } from '@/lib/haptics'
import { useBoot } from '@/stores/boot'
import { useConnection } from '@/stores/connection'
import { usePrefs } from '@/stores/prefs'

interface Page {
  key: string
  title: string
  body: string
  Scene: ComponentType<{ active: boolean }>
}

const PAGES: Page[] = [
  { key: 'meet', title: 'Meet your blobs', body: 'Every Hermes bot gets a face. Blobs shows you what each one is up to, and only calls on you when it’s your turn. Give one a poke.', Scene: Meet },
  { key: 'work', title: 'Watch them work', body: 'Each step a bot takes is one quiet line, live as it happens. Tap the line to see every step and what it printed.', Scene: Work },
  { key: 'ask', title: 'Answer when they ask', body: 'Approvals and questions arrive as a card you can answer from anywhere. Go on, it’s your call.', Scene: Ask },
  { key: 'inbox', title: 'Needs you', body: 'Every approval and question from every bot, gathered in one place, one card at a time. Swipe a card away once it’s handled.', Scene: Inbox },
  { key: 'screen', title: 'Take over the screen', body: 'Watch a bot’s desktop live. When it gets stuck, take the mouse and keyboard, then hand it back.', Scene: TakeOver },
  { key: 'rooms', title: 'Rooms and routines', body: 'Put several bots in one room and @mention who should answer. Routines run on a schedule, even while you sleep.', Scene: Rooms },
  { key: 'ready', title: 'Ready when you are', body: 'Blobs connects straight to your own Hermes server. No account, no analytics.', Scene: Ready },
]

const LAST = PAGES.length - 1

/** A page: its scene on top, its words below. As it slides, the scene sweeps a little further than the page and the words fade. */
function TourPage({ page, at, offset, width, active, mounted, title, body }: { page: Page; at: number; offset: SharedValue<number>; width: number; active: boolean; mounted: boolean; title: string; body: string }) {
  const stage = useAnimatedStyle(() => {
    const away = offset.get() / width - at

    return { transform: [{ translateX: -away * width * 0.18 }, { scale: 1 - Math.min(1, Math.abs(away)) * 0.06 }] }
  })
  const words = useAnimatedStyle(() => {
    const away = offset.get() / width - at

    return { opacity: 1 - Math.min(1, Math.abs(away) * 1.5), transform: [{ translateX: away * width * 0.32 }] }
  })
  const { Scene } = page

  return (
    <View style={[styles.page, { width }]}>
      <Animated.View style={[styles.stage, stage]}>{mounted ? <Scene active={active} /> : null}</Animated.View>
      <Animated.View style={[styles.words, words]}>
        <T variant="title" accessibilityRole="header">
          {title}
        </T>
        <T variant="body" color="text2" style={styles.body}>
          {body}
        </T>
      </Animated.View>
    </View>
  )
}

/**
 * The tutorial: seven pages, each a live scene played by the brand's faces, that walk through what the app does. It opens
 * on its own before Connect on a first launch, and from Settings any time after. Swipe or tap Next; Skip leaves at once.
 */
export default function Tour() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const configured = useConnection(state => state.config !== null)
  const splashDone = useBoot(state => state.splashDone)
  const setTourSeen = usePrefs(state => state.setTourSeen)
  const [index, setIndex] = useState(0)
  const [held, setHeld] = useState(false)
  const pager = useAnimatedRef<Animated.ScrollView>()
  const offset = useSharedValue(0)
  // The page a tap on Next is heading for, so quick taps go a page each even before the first turn lands.
  const aim = useRef(0)

  const onScroll = useAnimatedScrollHandler(event => {
    offset.set(event.contentOffset.x)
  })

  function turned(page: number) {
    const at = Math.max(0, Math.min(LAST, page))
    setIndex(at)
    haptic('tick')

    if (at === aim.current || !isHeading(at)) {
      aim.current = at
    }
  }

  // Turning toward the page Next aims at is on the way there; anything else is a swipe of your own.
  function isHeading(at: number): boolean {
    return at > index ? aim.current > at : aim.current < at
  }

  // The page counts as turned once the swipe is past halfway: the dots, the buttons and the scenes follow from there.
  useAnimatedReaction(
    () => Math.round(offset.get() / Math.max(1, width)),
    (page, before) => {
      if (before !== null && page !== before) {
        runOnJS(turned)(page)
      }
    },
  )

  function next() {
    aim.current = Math.min(LAST, Math.max(aim.current, index) + 1)
    pager.current?.scrollTo({ x: aim.current * width, animated: true })
  }

  function finish() {
    setTourSeen()

    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/connect')
    }
  }

  // Android's back button turns back a page before it leaves.
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) {
        return false
      }

      aim.current = index - 1
      pager.current?.scrollTo({ x: aim.current * width, animated: true })

      return true
    })

    return () => listener.remove()
  }, [index, width, pager])

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pill label={configured ? 'Close' : 'Skip'} variant="ghost" height={40} onPress={finish} style={index === LAST ? styles.gone : undefined} />
      </View>

      <PagerHold.Provider value={setHeld}>
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          scrollEnabled={!held}
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.pager}
        >
          {PAGES.map((page, at) => (
            <TourPage
              key={page.key}
              page={page}
              at={at}
              offset={offset}
              width={width}
              active={at === index && splashDone}
              // Only the pages beside you are drawn: the rest wait, and play from the start when you reach them.
              mounted={Math.abs(at - index) <= 1}
              // Someone already connected is replaying it from Settings.
              title={at === LAST && configured ? 'That’s the tour' : page.title}
              body={at === LAST && configured ? 'Take it again any time from Settings.' : page.body}
            />
          ))}
        </Animated.ScrollView>
      </PagerHold.Provider>

      <View style={styles.foot}>
        <PageDots count={PAGES.length} index={index} offset={offset} width={width} />
        {index === LAST ? (
          <Animated.View key="done" entering={FadeIn.duration(200)}>
            <Pill label={configured ? 'Done' : 'Get started'} variant="primary" height={48} onPress={finish} />
          </Animated.View>
        ) : (
          <Pill label="Next" height={48} onPress={next} accessibilityLabel="Next page" />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  top: { height: 48, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 12 },
  gone: { opacity: 0, pointerEvents: 'none' },
  pager: { flex: 1 },
  page: { flex: 1 },
  stage: { flex: 1, paddingHorizontal: 24, paddingBottom: 12 },
  words: { minHeight: 148, paddingHorizontal: 24, paddingTop: 8 },
  body: { marginTop: 8 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12 },
})
