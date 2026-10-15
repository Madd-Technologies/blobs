import { useEffect } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme/ThemeProvider'

const W = 51
const H = 31
const KNOB = 27
const PAD = 2

interface Props {
  value: boolean
  onValueChange: (next: boolean) => void
  label: string
  disabled?: boolean
}

/** Monochrome toggle: on is the primary white; off is pressed into the paper (the canvas color). No green. */
export function Switch({ value, onValueChange, label, disabled }: Props) {
  const { c } = useTheme()
  const progress = useSharedValue(value ? 1 : 0)

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 160 })
  }, [value, progress])

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [c.canvas, c.primary]),
  }))
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (W - KNOB - PAD * 2) }],
    backgroundColor: interpolateColor(progress.value, [0, 1], [c.text2, c.onPrimary]),
  }))

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        haptic(value ? 'toggleOff' : 'toggleOn')
        onValueChange(!value)
      }}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: PAD, justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
})
