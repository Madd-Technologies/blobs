import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import type { Gaze } from '@/components/bots/BotFace'
import type { CrowdId } from '@/features/tour/crowd'
import { haptic } from '@/lib/haptics'

import { CrowdFace } from './kit'

/** The crowd's places in a 320 x 260 box: each face's centre and size. The order is the order they land in. */
const SPOTS: { id: CrowdId; x: number; y: number; size: number }[] = [
  { id: 'scribe', x: 50, y: 188, size: 70 },
  { id: 'scout', x: 96, y: 78, size: 80 },
  { id: 'courier', x: 162, y: 176, size: 112 },
  { id: 'forge', x: 234, y: 72, size: 84 },
  { id: 'ember', x: 276, y: 192, size: 70 },
]

const BOX = { width: 320, height: 260 }
/** How far a finger has to be from a face's middle for its eyes to look all the way (points, before sizing to the screen). */
const LOOK_RANGE = 110

interface Touch {
  x: number
  y: number
}

type Spot = (typeof SPOTS)[number]

function MeetFace({ spot, order, enter, touch, focus, poked }: { spot: Spot; order: number; enter: boolean; touch: SharedValue<Touch>; focus: SharedValue<number>; poked: number }) {
  const reduced = useReducedMotion()
  const fall = useSharedValue(reduced ? 0 : 1)
  const breath = useSharedValue(0)
  const hop = useSharedValue(0)
  const [poke, setPoke] = useState(0)
  const [seenPoke, setSeenPoke] = useState(poked)

  // A tap on this face: squish, blink and a hop.
  if (poked !== seenPoke) {
    setSeenPoke(poked)
    setPoke(count => count + 1)
  }

  useEffect(() => {
    if (poked > 0 && !reduced) {
      hop.set(withSequence(withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 8, stiffness: 220 })))
    }
  }, [poked, reduced, hop])

  // They drop in one after another, land with a squish, then breathe, each on its own clock.
  useEffect(() => {
    if (!enter || reduced) {
      return
    }

    const delay = order * 110
    fall.set(withDelay(delay, withSpring(0, { damping: 13, stiffness: 150, mass: 0.9 })))
    const landed = setTimeout(() => setPoke(count => count + 1), delay + 330)
    const period = 2400 + order * 330
    breath.set(withDelay(delay + 600, withRepeat(withTiming(1, { duration: period / 2, easing: Easing.inOut(Easing.sin) }), -1, true)))

    return () => clearTimeout(landed)
  }, [enter, reduced, order, fall, breath])

  const gaze = useDerivedValue<Gaze>(() => {
    const at = touch.get()
    const amount = focus.get()
    const clamp = (value: number) => Math.max(-1, Math.min(1, value))

    return { x: clamp((at.x - spot.x) / LOOK_RANGE) * amount, y: clamp((at.y - spot.y) / LOOK_RANGE) * amount }
  })

  const style = useAnimatedStyle(() => ({
    opacity: enter || reduced ? 1 : 0,
    transform: [
      { translateY: -fall.get() * 300 - breath.get() * spot.size * 0.025 - hop.get() * spot.size * 0.22 },
      { scaleY: 1 + breath.get() * 0.022 },
    ],
  }))

  return (
    <Animated.View style={[styles.face, { left: spot.x - spot.size / 2, top: spot.y - spot.size / 2, width: spot.size, height: spot.size }, style]}>
      <CrowdFace id={spot.id} size={spot.size} motion="idle" poke={poke} gaze={gaze} />
    </Animated.View>
  )
}

/**
 * The tutorial's first scene: the five faces drop in and come alive. Their eyes follow a finger anywhere on the stage, and a
 * tap on one squishes it and makes it hop. The touch never claims the gesture, so swiping still turns the page.
 */
export function Meet({ active }: { active: boolean }) {
  const { width } = useWindowDimensions()
  // Drawn at the size that fits rather than scaled, so the faces stay sharp.
  const scale = Math.min(1.2, (width - 40) / BOX.width)
  const spots = useMemo(() => SPOTS.map(spot => ({ ...spot, x: spot.x * scale, y: spot.y * scale, size: Math.round(spot.size * scale) })), [scale])
  const [entered, setEntered] = useState(active)
  const [pokes, setPokes] = useState<Record<string, number>>({})
  const touch = useSharedValue<Touch>({ x: BOX.width / 2, y: BOX.height / 2 })
  const start = useSharedValue<Touch>({ x: 0, y: 0 })
  const focus = useSharedValue(0)

  // Enter once, the first time the page shows (after the splash): coming back finds them already there.
  if (active && !entered) {
    setEntered(true)
  }

  function tapped(index: number) {
    const spot = spots[index]

    if (spot) {
      haptic('tick')
      setPokes(current => ({ ...current, [spot.id]: (current[spot.id] ?? 0) + 1 }))
    }
  }

  const look = Gesture.Manual()
    .onTouchesDown(event => {
      const finger = event.allTouches[0]

      if (finger) {
        touch.set({ x: finger.x, y: finger.y })
        start.set({ x: finger.x, y: finger.y })
        focus.set(withTiming(1, { duration: 160 }))
      }
    })
    .onTouchesMove(event => {
      const finger = event.allTouches[0]

      if (finger) {
        touch.set({ x: finger.x, y: finger.y })
      }
    })
    .onTouchesUp(event => {
      const finger = event.changedTouches[0]
      focus.set(withTiming(0, { duration: 600 }))

      if (!finger || Math.hypot(finger.x - start.get().x, finger.y - start.get().y) > 12) {
        return
      }

      // A tap: the face under the finger, if any.
      const index = spots.findIndex(spot => Math.hypot(finger.x - spot.x, finger.y - spot.y) < spot.size * 0.45)

      if (index >= 0) {
        runOnJS(tapped)(index)
      }
    })
    .onTouchesCancelled(() => {
      focus.set(withTiming(0, { duration: 600 }))
    })

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={look}>
        <View style={{ width: BOX.width * scale, height: BOX.height * scale }}>
          {spots.map((spot, order) => (
            <MeetFace key={spot.id} spot={spot} order={order} enter={entered} touch={touch} focus={focus} poked={pokes[spot.id] ?? 0} />
          ))}
        </View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  face: { position: 'absolute', transformOrigin: 'center bottom' },
})
