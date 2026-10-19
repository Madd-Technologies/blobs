import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import type { CrowdId } from '@/features/tour/crowd'
import { haptic } from '@/lib/haptics'

import { CrowdFace } from './kit'

/** The line-up, Courier in the middle. */
const ROW: { id: CrowdId; size: number }[] = [
  { id: 'ember', size: 52 },
  { id: 'scout', size: 64 },
  { id: 'courier', size: 86 },
  { id: 'forge', size: 64 },
  { id: 'scribe', size: 52 },
]
const GAP = 6
const ROW_WIDTH = ROW.reduce((sum, face) => sum + face.size, 0) + GAP * (ROW.length - 1)

/** Ember wakes this long after the page shows; the waves start after it and repeat. */
const WAKE_MS = 900
const WAVE_FROM_MS = 1300
const WAVE_EVERY_MS = 3400
const WAVE_GAP_MS = 60

function Waver({ id, size, index, active, motion, poke }: { id: CrowdId; size: number; index: number; active: boolean; motion: 'idle' | 'doze'; poke: number }) {
  const reduced = useReducedMotion()
  const hop = useSharedValue(0)
  const [pokes, setPokes] = useState(0)

  useEffect(() => {
    if (!active || reduced) {
      return
    }

    const once = withSequence(withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 210, easing: Easing.in(Easing.quad) }))
    hop.set(withDelay(WAVE_FROM_MS + index * WAVE_GAP_MS, withRepeat(withSequence(once, withDelay(WAVE_EVERY_MS - 370, withTiming(0, { duration: 0 }))), -1, false)))

    return () => {
      cancelAnimation(hop)
      hop.set(0)
    }
  }, [active, reduced, index, hop])

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -hop.get() * size * 0.2 }] }))

  return (
    <Pressable
      accessible={false}
      hitSlop={6}
      onPress={() => {
        haptic('tick')
        setPokes(count => count + 1)
      }}
    >
      <Animated.View style={style}>
        <CrowdFace id={id} size={size} motion={motion} poke={poke + pokes} />
      </Animated.View>
    </Pressable>
  )
}

/** The last page: the whole crowd in a row, Ember still dozing until it notices, then everyone waves now and then. */
export function Ready({ active }: { active: boolean }) {
  const { width } = useWindowDimensions()
  const scale = Math.min(1, (width - 48) / ROW_WIDTH)
  const [awake, setAwake] = useState(false)
  const [was, setWas] = useState(active)

  if (was !== active) {
    setWas(active)
    setAwake(false)
  }

  useEffect(() => {
    if (!active) {
      return
    }

    const timer = setTimeout(() => setAwake(true), WAKE_MS)

    return () => clearTimeout(timer)
  }, [active])

  return (
    <View style={styles.fill}>
      <View style={[styles.row, { transform: [{ scale }] }]}>
        {ROW.map((face, index) => (
          <Waver key={face.id} {...face} index={index} active={active} motion={face.id === 'ember' && !awake ? 'doze' : 'idle'} poke={face.id === 'ember' && awake ? 1 : 0} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { width: ROW_WIDTH, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: GAP },
})
