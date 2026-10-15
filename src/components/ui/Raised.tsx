import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'

import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme/ThemeProvider'
import { motion, raisedStyle } from '@/theme/tokens'

/** True inside something raised: secondary buttons there are pressed in (the level below) instead of sitting on it. */
const RaisedContext = createContext(false)

export function useOnRaised(): boolean {
  return useContext(RaisedContext)
}

/** Mark a subtree as raised without drawing anything (a sheet draws its own panel). */
export function RaisedScope({ children }: { children: ReactNode }) {
  return <RaisedContext.Provider value>{children}</RaisedContext.Provider>
}

interface Props {
  children: ReactNode
  /** 24 for approval and question cards, 22 the Needs-you card, 26 the deck's top card, 28 the composer tray. */
  radius: number
  style?: StyleProp<ViewStyle>
  /**
   * Rise in on mount: from 16 px below on a spring, fading in, with a Confirm haptic. For cards that ask something new. A
   * string rises only the first time that key is seen (a list that recycles rows mounts a card again when you scroll back).
   */
  rise?: boolean | string
  /** The face color this card is tinted with when it is not the screen's own bot (a card in the deck). */
  fill?: string
  edge?: string
  accessibilityLabel?: string
}

/** The raised level: one step lighter than the tone, a 1 px lighter top edge and a soft shadow. Only for what you must act on. */
export function Raised({ children, radius, style, rise, fill, edge, accessibilityLabel }: Props) {
  const { c } = useTheme()
  // Decided once, on mount: whether this card is new.
  const [rising] = useState(() => firstRise(rise))
  const base = raisedStyle(c)
  const surface = { backgroundColor: fill ?? base.backgroundColor, boxShadow: `inset 0 1px 0 ${edge ?? c.edge}, ${c.shadow}`, borderRadius: radius }

  if (!rising) {
    return (
      <RaisedContext.Provider value>
        <View accessibilityLabel={accessibilityLabel} style={[surface, style]}>
          {children}
        </View>
      </RaisedContext.Provider>
    )
  }

  return (
    <RaisedContext.Provider value>
      <RiseIn accessibilityLabel={accessibilityLabel} style={[surface, style]}>
        {children}
      </RiseIn>
    </RaisedContext.Provider>
  )
}

const risen = new Set<string>()

function firstRise(rise: boolean | string | undefined): boolean {
  if (typeof rise !== 'string') {
    return !!rise
  }

  if (risen.has(rise)) {
    return false
  }

  risen.add(rise)

  return true
}

/** Rises from 16 px below, easing out with no overshoot, and fades in, with a Confirm haptic; with reduced motion it only fades. */
export function RiseIn({ children, style, accessibilityLabel, quiet }: { children: ReactNode; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; quiet?: boolean }) {
  const reduced = useReducedMotion()
  const shown = useSharedValue(0)

  useEffect(() => {
    shown.value = withTiming(1, reduced ? { duration: 180 } : { duration: 260, easing: Easing.out(Easing.cubic) })

    if (!quiet) {
      haptic('confirm')
    }
  }, [shown, reduced, quiet])

  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.value * 1.4),
    transform: reduced ? [] : [{ translateY: (1 - shown.value) * motion.riseFrom }],
  }))

  return (
    <Animated.View accessibilityLabel={accessibilityLabel} style={[style, animated]}>
      {children}
    </Animated.View>
  )
}
