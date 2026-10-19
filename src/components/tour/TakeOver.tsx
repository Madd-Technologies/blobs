import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { Pill } from '@/components/ui/Pill'
import { T } from '@/components/ui/T'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { Arrive, BotPanel, CrowdFace, Settle, usePagerHold } from './kit'

/** Where Scout's cursor goes on its screen (shares of its width and height), clicking at each. */
const PATH = [
  { x: 0.22, y: 0.62 },
  { x: 0.7, y: 0.42 },
  { x: 0.56, y: 0.8 },
  { x: 0.84, y: 0.16 },
] as const
/** One leg of the path: moving, then a click and a pause. */
const LEG_MS = 1300
const MOVE_SHARE = 0.55

/** The keys a phone keyboard lacks, as the take-over keys row has them. */
const KEYS = ['esc', 'tab', 'ctrl', '←', '→', 'enter']

/** A pointer: Scout's carries its face, yours is bare. */
function Pointer({ face }: { face?: boolean }) {
  const { c } = useTheme()

  return (
    <View style={styles.pointer}>
      <Feather name="mouse-pointer" size={16} color={c.text} />
      {face ? (
        <View style={styles.pointerFace}>
          <CrowdFace id="scout" size={16} />
        </View>
      ) : null}
    </View>
  )
}

/**
 * Scout using its screen: a desktop in miniature, its pointer gliding and clicking. Take over and the pointer is yours to
 * drag around, with the keys a phone lacks underneath; hand back and Scout carries on.
 */
export function TakeOver({ active }: { active: boolean }) {
  const { c } = useTheme()
  const reduced = useReducedMotion()
  const hold = usePagerHold()
  const [yours, setYours] = useState(false)
  const [was, setWas] = useState(active)
  const size = useSharedValue({ width: 1, height: 1 })
  const leg = useSharedValue(0)
  const shown = useSharedValue(1)
  const mine = useSharedValue({ x: 0.5, y: 0.5 })
  const grab = useSharedValue({ x: 0.5, y: 0.5 })
  const click = useSharedValue(0)

  if (was !== active) {
    setWas(active)
    setYours(false)
  }

  // While you hold the screen the pages stay put, so a drag always moves your pointer.
  useEffect(() => {
    hold(yours)

    return () => hold(false)
  }, [yours, hold])

  // Scout's pointer runs its path round and round while it has the screen.
  useEffect(() => {
    shown.set(withTiming(yours ? 0 : 1, { duration: 220 }))

    if (!active || yours || reduced) {
      cancelAnimation(leg)

      return
    }

    leg.set(withRepeat(withTiming(PATH.length, { duration: PATH.length * LEG_MS, easing: Easing.linear }), -1, false))

    return () => cancelAnimation(leg)
  }, [active, yours, reduced, leg, shown])

  const scout = useDerivedValue(() => {
    const at = leg.get() % PATH.length
    const index = Math.floor(at)
    const part = at - index
    const from = PATH[index] ?? PATH[0]
    const to = PATH[(index + 1) % PATH.length] ?? PATH[0]
    const moved = Math.min(1, part / MOVE_SHARE)
    const eased = moved < 0.5 ? 2 * moved * moved : 1 - (-2 * moved + 2) ** 2 / 2

    return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased, ring: part < MOVE_SHARE ? 0 : (part - MOVE_SHARE) / (1 - MOVE_SHARE) }
  })

  const scoutStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateX: scout.get().x * size.get().width }, { translateY: scout.get().y * size.get().height }],
  }))
  const scoutRing = useAnimatedStyle(() => {
    const ring = scout.get().ring

    return {
      opacity: shown.get() * (ring > 0 ? 0.3 * (1 - ring) : 0),
      transform: [{ translateX: scout.get().x * size.get().width - 14 }, { translateY: scout.get().y * size.get().height - 14 }, { scale: 0.4 + ring * 1.1 }],
    }
  })
  const mineStyle = useAnimatedStyle(() => ({
    opacity: 1 - shown.get(),
    transform: [{ translateX: mine.get().x * size.get().width }, { translateY: mine.get().y * size.get().height }],
  }))
  const mineRing = useAnimatedStyle(() => ({
    opacity: click.get() > 0 ? 0.3 * (1 - click.get()) : 0,
    transform: [{ translateX: mine.get().x * size.get().width - 14 }, { translateY: mine.get().y * size.get().height - 14 }, { scale: 0.4 + click.get() * 1.1 }],
  }))

  // Yours: drag to move the pointer, tap to click.
  const drag = Gesture.Pan()
    .enabled(yours)
    .minDistance(0)
    .onBegin(() => {
      grab.set(mine.get())
    })
    .onUpdate(event => {
      const clamp = (value: number) => Math.max(0.02, Math.min(0.96, value))
      mine.set({ x: clamp(grab.get().x + event.translationX / size.get().width), y: clamp(grab.get().y + event.translationY / size.get().height) })
    })
    .onFinalize(event => {
      if (Math.hypot(event.translationX, event.translationY) < 6) {
        click.set(withSequence(withTiming(0.01, { duration: 0 }), withTiming(1, { duration: 380 }), withTiming(0, { duration: 0 })))
        runOnJS(haptic)('tick')
      }
    })

  return (
    <View style={styles.fill}>
      <BotPanel
        id="scout"
        faceSize={80}
        status={yours ? 'Waiting. You have the screen' : 'Using its screen'}
        face={<CrowdFace id="scout" size={80} motion={yours ? 'idle' : 'work'} />}
      >
        <GestureDetector gesture={drag}>
          <View
            style={[styles.desk, { backgroundColor: c.tone }]}
            onLayout={event => size.set({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
          >
            <View style={[styles.window, { backgroundColor: c.canvas }]}>
              <View style={[styles.bar, { backgroundColor: c.sheet }]}>
                <View style={[styles.address, { backgroundColor: c.tone }]} />
              </View>
              <View style={styles.page}>
                <View style={[styles.hero, { backgroundColor: c.sheet }]} />
                <View style={[styles.line, { backgroundColor: c.tone }]} />
                <View style={[styles.line, styles.short, { backgroundColor: c.tone }]} />
                <View style={[styles.button, { backgroundColor: c.text2 }]} />
              </View>
            </View>
            <Animated.View pointerEvents="none" style={[styles.ring, { backgroundColor: c.text }, scoutRing]} />
            <Animated.View pointerEvents="none" style={[styles.at, scoutStyle]}>
              <Pointer face />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.ring, { backgroundColor: c.text }, mineRing]} />
            <Animated.View pointerEvents="none" style={[styles.at, mineStyle]}>
              <Pointer />
            </Animated.View>
          </View>
        </GestureDetector>

        {yours ? (
          <Arrive>
            <View style={styles.keys}>
              {KEYS.map(key => (
                <View key={key} style={[styles.key, { backgroundColor: c.tone }]}>
                  <T variant="meta" style={styles.mono}>
                    {key}
                  </T>
                </View>
              ))}
            </View>
          </Arrive>
        ) : null}
        <Settle style={styles.controls}>
          <T variant="label" color="text2" style={styles.flex}>
            {yours ? 'Drag to move, tap to click' : 'Live, as Scout sees it'}
          </T>
          <Pill
            label={yours ? 'Hand back' : 'Take over'}
            variant="primary"
            height={40}
            onPress={() => {
              haptic(yours ? 'toggleOff' : 'toggleOn')
              mine.set({ x: 0.5, y: 0.5 })
              setYours(!yours)
            }}
          />
        </Settle>
      </BotPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  // The panel grows upward from just above the words, like a chat.
  fill: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  flex: { flex: 1 },
  desk: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.thumb, overflow: 'hidden', padding: '5%' },
  window: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  bar: { height: '16%', justifyContent: 'center', paddingHorizontal: '6%' },
  address: { height: '46%', width: '58%', borderRadius: 999, alignSelf: 'center' },
  page: { flex: 1, padding: '6%', gap: 6 },
  hero: { height: '38%', borderRadius: 6 },
  line: { height: '8%', borderRadius: 3, width: '86%' },
  short: { width: '54%' },
  button: { height: '14%', width: '30%', borderRadius: 999, opacity: 0.5 },
  at: { position: 'absolute', left: 0, top: 0 },
  pointer: { width: 34, height: 30 },
  pointerFace: { position: 'absolute', left: 13, top: 12 },
  ring: { position: 'absolute', left: 0, top: 0, width: 28, height: 28, borderRadius: 14 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  keys: { flexDirection: 'row', gap: 6 },
  key: { flex: 1, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: fonts.mono },
})
