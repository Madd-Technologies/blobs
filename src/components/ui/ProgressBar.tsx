import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { useTheme } from '@/theme/ThemeProvider'

/**
 * A quiet determinate bar: the spinner's track with its bright fill, grown by transform only. Drawn only for a fraction the
 * server gave (finished of started), never a guess.
 */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const { c } = useTheme()
  const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const shown = useSharedValue(fraction)

  useEffect(() => {
    shown.value = withTiming(fraction, { duration: 420, easing: Easing.out(Easing.cubic) })
  }, [fraction, shown])

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: shown.value }] }))

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: total, now: done }} style={[styles.track, { backgroundColor: c.track }]}>
      <Animated.View style={[styles.fill, { backgroundColor: c.text }, fill]} />
    </View>
  )
}

const styles = StyleSheet.create({
  track: { height: 3, borderRadius: 1.5, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 1.5, transformOrigin: 'left' },
})
