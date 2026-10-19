import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { useTheme } from '@/theme/ThemeProvider'

import { CrowdFace } from './kit'

const DOT = 7
const STEP = 20
const FACE = 20
/** How high the face hops between two dots, at the middle of a swipe. */
const HOP = 10

/**
 * Where you are in the tutorial: a dot per page, and a tiny Courier standing on the current one. It follows the swipe,
 * hopping from dot to dot.
 */
export function PageDots({ count, index, offset, width }: { count: number; index: number; offset: SharedValue<number>; width: number }) {
  const { c } = useTheme()

  const hopping = useAnimatedStyle(() => {
    const at = Math.max(0, Math.min(count - 1, offset.get() / Math.max(1, width)))
    const between = at - Math.floor(at)

    return {
      transform: [
        { translateX: at * STEP },
        { translateY: -Math.sin(between * Math.PI) * HOP },
        // Stretched in the air, round again on landing.
        { scaleY: 1 + Math.sin(between * Math.PI) * 0.12 },
        { scaleX: 1 - Math.sin(between * Math.PI) * 0.08 },
      ],
    }
  })

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`Page ${index + 1} of ${count}`} style={[styles.track, { width: STEP * (count - 1) + FACE }]}>
      {Array.from({ length: count }, (_, page) => (
        <View key={page} style={[styles.dot, { left: page * STEP + (FACE - DOT) / 2, backgroundColor: c.track }]} />
      ))}
      <Animated.View style={[styles.face, hopping]}>
        <CrowdFace id="courier" size={FACE} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  track: { height: FACE + HOP, justifyContent: 'flex-end' },
  dot: { position: 'absolute', bottom: (FACE - DOT) / 2, width: DOT, height: DOT, borderRadius: DOT / 2 },
  face: { position: 'absolute', left: 0, bottom: 0, width: FACE, height: FACE },
})
