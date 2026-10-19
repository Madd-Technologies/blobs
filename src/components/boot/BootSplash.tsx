import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, useColorScheme } from 'react-native'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated'

import { BotFace } from '@/components/bots/BotFace'
import { CROWD, crowdSvg, type CrowdId } from '@/features/tour/crowd'
import { haptic } from '@/lib/haptics'
import { useBoot } from '@/stores/boot'
import { fonts, palettes } from '@/theme/tokens'

/** Courier's size on the native splash, in points: `imageWidth` of expo-splash-screen in app.json. Change both together. */
export const SPLASH_FACE = 120

/** Courier's friends, spilling out from behind it: how far from the middle each lands (points) and how big it is. */
const FRIENDS: { id: CrowdId; dx: number; size: number }[] = [
  { id: 'ember', dx: -150, size: 52 },
  { id: 'scout', dx: -84, size: 64 },
  { id: 'forge', dx: 84, size: 64 },
  { id: 'scribe', dx: 150, size: 52 },
]

/** The beats, in ms from the hand-off. Tune the feel here. */
const AT = {
  /** Courier wakes: a blink and a small squish. */
  wake: 140,
  /** It crouches... */
  crouch: 280,
  /** ...and jumps; its friends spill out from behind it, one after another. */
  jump: 440,
  friendGap: 55,
  /** It lands (a tick), and the name rises in. */
  land: 880,
  name: 900,
  /** Everyone hops once, left to right: hello. */
  wave: 1060,
  waveGap: 55,
  /** The splash lifts away. */
  exit: 1330,
  exitFor: 260,
} as const

const out = Easing.out(Easing.quad)
const into = Easing.in(Easing.quad)

/** One hop, `delay` ms from now: up by a share of the face, then down. */
function hopAt(delay: number) {
  return withDelay(delay, withSequence(withTiming(1, { duration: 150, easing: out }), withTiming(0, { duration: 190, easing: into })))
}

function Friend({ id, dx, size, index, play }: { id: CrowdId; dx: number; size: number; index: number; play: boolean }) {
  const spill = useSharedValue(0)
  const hop = useSharedValue(0)
  const xml = useMemo(() => crowdSvg(id, size), [id, size])

  useEffect(() => {
    if (!play) {
      return
    }

    spill.set(withDelay(AT.jump + 20 + index * AT.friendGap, withSpring(1, { damping: 11, stiffness: 170, mass: 0.8 })))
    // Courier is in the middle of the wave, after the two on its left.
    hop.set(hopAt(AT.wave + (index < 2 ? index : index + 1) * AT.waveGap))
  }, [play, index, spill, hop])

  const style = useAnimatedStyle(() => {
    const t = spill.get()

    return {
      opacity: Math.min(1, t * 3),
      transform: [
        // From behind Courier's middle, out along an arc, to its place.
        { translateX: (1 - t) * -dx },
        { translateY: (1 - t) * -(SPLASH_FACE - size) * 0.4 - Math.sin(Math.min(1, t) * Math.PI) * 34 - hop.get() * size * 0.16 },
        { scale: 0.35 + 0.65 * t },
      ],
    }
  })

  return (
    <Animated.View style={[styles.friend, { width: size, height: size, left: SPLASH_FACE / 2 + dx - size / 2, top: SPLASH_FACE - size }, style]}>
      <BotFace name={CROWD[id].name} xml={xml} size={size} motion="idle" />
    </Animated.View>
  )
}

/** Courier's jump: crouch, leap, land with a squash, and its hop in the wave. */
function useCourierJump(play: boolean) {
  // squash: 1 is crouched (short and wide), negative is stretched (tall and thin).
  const squash = useSharedValue(0)
  const lift = useSharedValue(0)
  const hop = useSharedValue(0)

  useEffect(() => {
    if (!play) {
      return
    }

    const air = (AT.land - AT.jump) / 2
    squash.set(
      withDelay(
        AT.crouch,
        withSequence(
          withTiming(1, { duration: AT.jump - AT.crouch, easing: out }),
          withTiming(-0.7, { duration: 110 }),
          withTiming(0, { duration: air - 110 }),
          withDelay(air, withTiming(0.75, { duration: 70, easing: out })),
          withSpring(0, { damping: 9, stiffness: 260 }),
        ),
      ),
    )
    lift.set(withDelay(AT.jump, withSequence(withTiming(-0.5, { duration: air, easing: out }), withTiming(0, { duration: air, easing: into }))))
    hop.set(hopAt(AT.wave + 2 * AT.waveGap))
  }, [play, squash, lift, hop])

  return useAnimatedStyle(() => ({
    transform: [
      { translateY: (lift.get() - hop.get() * 0.12) * SPLASH_FACE },
      { scaleX: 1 + squash.get() * 0.1 },
      { scaleY: 1 - squash.get() * 0.14 },
    ],
  }))
}

/**
 * The cold-boot splash. It takes over from the native splash on the very same frame (Courier, `SPLASH_FACE` points wide,
 * in the middle of the system's canvas), then plays: Courier wakes, crouches and jumps, its four friends spill out from
 * behind it, it lands, the name rises in, everyone waves, and the splash lifts away. About a second and a half, once per
 * launch; under Reduce Motion it only fades. It never takes a touch: the app below is live the whole time.
 */
export function BootSplash() {
  const reduced = useReducedMotion()
  // The native splash follows the system's appearance, not the app's theme setting: match it until the splash is gone.
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark'
  const c = palettes[scheme]
  const finishSplash = useBoot(state => state.finishSplash)
  const [play, setPlay] = useState(false)
  const [poke, setPoke] = useState(0)
  const jump = useCourierJump(play && !reduced)
  const courierXml = useMemo(() => crowdSvg('courier', SPLASH_FACE), [])
  const shown = useSharedValue(1)
  const name = useSharedValue(reduced ? 1 : 0)

  // The overlay is drawn: hide the native splash under it (two frames later, so the faces have been painted) and play.
  function onLayout() {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void SplashScreen.hideAsync()
        setPlay(true)
      }),
    )
  }

  useEffect(() => {
    if (!play) {
      return
    }

    const done = () => finishSplash()

    if (reduced) {
      shown.set(withDelay(450, withTiming(0, { duration: 220 }, finished => finished && runOnJS(done)())))

      return
    }

    const timers = [setTimeout(() => setPoke(1), AT.wake), setTimeout(() => haptic('tick'), AT.land)]
    name.set(withDelay(AT.name, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) })))
    shown.set(withDelay(AT.exit, withTiming(0, { duration: AT.exitFor, easing: Easing.out(Easing.cubic) }, finished => finished && runOnJS(done)())))

    return () => timers.forEach(clearTimeout)
  }, [play, reduced, finishSplash, shown, name])

  const fade = useAnimatedStyle(() => ({ opacity: shown.get() }))
  // As it lifts away, the crowd drifts up a little and grows, as if you walked past it into the app.
  const crowd = useAnimatedStyle(() => ({ transform: reduced ? [] : [{ translateY: (1 - shown.get()) * -10 }, { scale: 1 + (1 - shown.get()) * 0.05 }] }))
  const nameStyle = useAnimatedStyle(() => ({ opacity: name.get(), transform: [{ translateY: (1 - name.get()) * 10 }] }))

  return (
    <Animated.View testID="boot-splash" accessible accessibilityLabel="Blobs" pointerEvents="none" onLayout={onLayout} style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.canvas }, fade]}>
      <Animated.View style={[styles.stage, crowd]}>
        {reduced ? null : FRIENDS.map((friend, index) => <Friend key={friend.id} {...friend} index={index} play={play} />)}
        <Animated.View style={[styles.courier, jump]}>
          <BotFace name="Courier" xml={courierXml} size={SPLASH_FACE} motion={reduced ? 'still' : 'idle'} poke={poke} />
        </Animated.View>
        <Animated.View style={[styles.name, nameStyle]}>
          <Text style={[styles.word, { color: c.text }]}>Blobs</Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  // Exactly the native splash's face: everything else hangs off it without moving it.
  stage: { width: SPLASH_FACE, height: SPLASH_FACE },
  // Crouching and landing squash from the feet, not the middle.
  courier: { width: SPLASH_FACE, height: SPLASH_FACE, transformOrigin: 'center bottom' },
  friend: { position: 'absolute' },
  name: { position: 'absolute', top: SPLASH_FACE + 18, left: -120, right: -120, alignItems: 'center' },
  word: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
})
