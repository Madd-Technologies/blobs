import { useEffect } from 'react'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { useTheme } from '@/theme/ThemeProvider'

/** A 12 px ring with one bright arc, for "this is running right now". */
export function Spinner({ size = 12 }: { size?: number }) {
  const { c } = useTheme()
  const turn = useSharedValue(0)

  useEffect(() => {
    turn.value = withRepeat(withTiming(360, { duration: 850, easing: Easing.linear }), -1, false)

    return () => cancelAnimation(turn)
  }, [turn])

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }))

  return <Animated.View accessibilityLabel="Working" style={[{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.8, borderColor: c.track, borderTopColor: c.text }, style]} />
}
