import { useRouter } from 'expo-router'
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, runOnJS, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'

import { Dashboard } from '@/components/tour/Dashboard'
import { Inbox } from '@/components/tour/Inbox'
import { PagerHold } from '@/components/tour/kit'
import { Meet } from '@/components/tour/Meet'
import { PageDots } from '@/components/tour/PageDots'
import { TakeOver } from '@/components/tour/TakeOver'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { T } from '@/components/ui/T'
import { haptic } from '@/lib/haptics'
import { useBoot } from '@/stores/ui'
import { useConnection } from '@/stores/connection'
import { usePrefs } from '@/stores/prefs'

interface Page {
  key: string
  title: string
  body: string
  Scene: ComponentType<{ active: boolean }>
}

const PAGES: Page[] = [
  { key: 'meet', title: 'Meet your blobs', body: 'Every Hermes bot gets a face. Watch what is in flight at a glance, and only step in when it’s your turn.', Scene: Meet },
  { key: 'inbox', title: 'Triage Needs you', body: 'Approvals, questions, and dashboard items gather in one stack. Filter, swipe to clear, or bulk-triage when a queue grows.', Scene: Inbox },
  { key: 'dashboard', title: 'Dashboards built for you', body: 'Ask any bot to track follow-ups, metrics, or briefings. Pull to refresh live panels whenever you want.', Scene: Dashboard },
  { key: 'screen', title: 'Take over the screen', body: 'Watch a bot’s desktop live and jump in with mouse or keyboard whenever needed. Direct to your server—no account or analytics.', Scene: TakeOver },
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
 * The tutorial: eight pages, each a live scene played by the brand's faces, that walk through what the app does. It opens
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
