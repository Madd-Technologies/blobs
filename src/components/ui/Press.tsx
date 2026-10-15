import { forwardRef } from 'react'
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type View, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'

import { motion } from '@/theme/tokens'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

interface Props extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>
  /** How far it sinks while held (0.97 by default, per the design system). */
  scale?: number
}

/**
 * A pressable that sinks to 0.97 on a spring while held and springs back on release: Card Stock's press. With reduced
 * motion it fades a little instead. Transform and opacity only, on the UI thread.
 */
export const Press = forwardRef<View, Props>(function Press({ style, scale = motion.pressScale, onPressIn, onPressOut, disabled, ...rest }, ref) {
  const reduced = useReducedMotion()
  const down = useSharedValue(0)

  const animated = useAnimatedStyle(() =>
    reduced ? { opacity: 1 - down.value * 0.3 } : { transform: [{ scale: 1 - down.value * (1 - scale) }] },
  )

  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      disabled={disabled}
      onPressIn={(event: GestureResponderEvent) => {
        down.value = reduced ? withTiming(1, { duration: 80 }) : withSpring(1, motion.press)
        onPressIn?.(event)
      }}
      onPressOut={(event: GestureResponderEvent) => {
        down.value = reduced ? withTiming(0, { duration: 120 }) : withSpring(0, motion.press)
        onPressOut?.(event)
      }}
      style={[style, animated]}
    />
  )
})
