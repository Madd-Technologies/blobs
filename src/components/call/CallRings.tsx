import { useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'

import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  /** Who is talking: you draw neutral rings, the bot's voice draws them in its face color; nobody, none. */
  who: 'you' | 'voice' | null
  /** How loud, 0 to 1. */
  level: number
  /** The bot's face color. */
  color: string
  /** The face's size; the rings reach 1.74 times it, and their space is kept when they are hidden. */
  size: number
  children: ReactNode
}

/**
 * How far each ring reaches (times the face's size), how strong it is (by theme: a face color shows more on dark paper), and the
 * scale it rests at when nobody is loud.
 */
const OUTER = { reach: 1.74, alpha: { dark: { you: 0.045, voice: 0.06 }, light: { you: 0.05, voice: 0.08 } }, rest: 0.8 }
const INNER = { reach: 1.4, alpha: { dark: { you: 0.075, voice: 0.1 }, light: { you: 0.08, voice: 0.16 } }, rest: 0.86 }

function Ring({ diameter, color, alpha, rest, shown, loud }: { diameter: number; color: string; alpha: number; rest: number; shown: SharedValue<number>; loud: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: shown.value * alpha, transform: [{ scale: rest + loud.value * (1 - rest) }] }))

  return <Animated.View aria-hidden style={[styles.ring, { width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: color }, style]} />
}

/**
 * The quiet rings behind a call's face that follow whoever is talking: transform and opacity only. With reduced motion they
 * still show who is talking, at a fixed size.
 */
export function CallRings({ who, level, color, size, children }: Props) {
  const { c, scheme } = useTheme()
  const outer = OUTER.alpha[scheme === 'light' ? 'light' : 'dark']
  const inner = INNER.alpha[scheme === 'light' ? 'light' : 'dark']
  const reduced = useReducedMotion()
  const loud = useSharedValue(0)
  const you = useSharedValue(0)
  const voice = useSharedValue(0)

  useEffect(() => {
    loud.value = withTiming(reduced ? 0.6 : Math.min(1, Math.max(0, level)), { duration: 140 })
  }, [level, reduced, loud])

  useEffect(() => {
    you.value = withTiming(who === 'you' ? 1 : 0, { duration: 220 })
    voice.value = withTiming(who === 'voice' ? 1 : 0, { duration: 220 })
  }, [who, you, voice])

  const box = size * OUTER.reach

  return (
    <View style={[styles.box, { width: box, height: box }]}>
      {/* Two sets, so a ring fading out keeps its color while the other fades in. */}
      <Ring diameter={box} color={c.text} alpha={outer.you} rest={OUTER.rest} shown={you} loud={loud} />
      <Ring diameter={size * INNER.reach} color={c.text} alpha={inner.you} rest={INNER.rest} shown={you} loud={loud} />
      <Ring diameter={box} color={color} alpha={outer.voice} rest={OUTER.rest} shown={voice} loud={loud} />
      <Ring diameter={size * INNER.reach} color={color} alpha={inner.voice} rest={INNER.rest} shown={voice} loud={loud} />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
})
