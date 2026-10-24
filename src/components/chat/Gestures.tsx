import Feather from '@expo/vector-icons/Feather'
import { createContext, useContext, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated'

import { T } from '@/components/ui/T'
import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme/ThemeProvider'
import { motion } from '@/theme/tokens'

/** How far the conversation slides left, and how much room each message's time gets. */
const STAMP_WIDTH = 72
/** How far a message is pulled right (counted from where the pull starts, past a little slack) before letting go replies. */
const REPLY_AT = 48

/** The drag that reveals the times, shared by every row of one list. */
const StampOffset = createContext<SharedValue<number> | null>(null)

/**
 * Drag a conversation left to see when each message was sent, as in Messages: every row slides over and its time shows on the
 * right; let go and they spring back. Only a leftward drag starts it (a rightward one is a reply, an up-and-down one scrolls).
 */
export function StampReveal({ children }: { children: ReactNode }) {
  const offset = useSharedValue(0)
  const pan = Gesture.Pan()
    .activeOffsetX(-14)
    .failOffsetX(12)
    .failOffsetY([-12, 12])
    .onUpdate(event => {
      // A little resistance: the times are there to glance at, not to pull far.
      offset.value = Math.max(-STAMP_WIDTH, Math.min(0, event.translationX * 0.7))
    })
    .onEnd(() => {
      offset.value = withSpring(0, motion.press)
    })

  return (
    <StampOffset.Provider value={offset}>
      <GestureDetector gesture={pan}>
        <View style={styles.fill}>{children}</View>
      </GestureDetector>
    </StampOffset.Provider>
  )
}

/**
 * A row that slides with that drag, with its time (when it has one) coming in on the right, level with the message's first line
 * (`top`, from the row's top): a long reply's time stays by its start rather than lost halfway down.
 */
export function Stamped({ time, top = 0, children }: { time?: string; top?: number; children: ReactNode }) {
  const offset = useContext(StampOffset)
  const content = useAnimatedStyle(() => ({ transform: [{ translateX: offset ? offset.value : 0 }] }))
  const stamp = useAnimatedStyle(() => {
    const value = offset ? offset.value : 0

    return { opacity: interpolate(value, [-STAMP_WIDTH, -STAMP_WIDTH * 0.35], [1, 0], 'clamp'), transform: [{ translateX: STAMP_WIDTH + value }] }
  })

  if (!offset) {
    return <>{children}</>
  }

  return (
    <View>
      <Animated.View style={content}>{children}</Animated.View>
      {time ? (
        <Animated.View pointerEvents="none" style={[styles.stamp, { top }, stamp]}>
          <T variant="meta" color="text2" numberOfLines={1}>
            {time}
          </T>
        </Animated.View>
      ) : null}
    </View>
  )
}

/**
 * Pull a message right to reply to it, as in WhatsApp and Signal: a reply arrow fades in behind it, a tick says when letting go
 * will reply, and it springs back either way. Only a rightward drag starts it.
 */
export function SwipeToReply({ onReply, label, children }: { onReply?: () => void; label: string; children: ReactNode }) {
  const { c } = useTheme()
  const x = useSharedValue(0)
  const armed = useSharedValue(false)
  const reply = () => onReply?.()
  const pan = Gesture.Pan()
    .enabled(!!onReply)
    .activeOffsetX(16)
    .failOffsetX(-10)
    .failOffsetY([-10, 10])
    .onUpdate(event => {
      const pulled = Math.max(0, event.translationX)
      // Past the point it follows the finger only a little: it has done its job.
      x.value = pulled > REPLY_AT ? REPLY_AT + (pulled - REPLY_AT) * 0.2 : pulled

      if ((pulled >= REPLY_AT) !== armed.value) {
        armed.value = pulled >= REPLY_AT

        if (armed.value) {
          runOnJS(haptic)('tick')
        }
      }
    })
    .onEnd(() => {
      if (armed.value) {
        runOnJS(reply)()
      }

      armed.value = false
      x.value = withSpring(0, motion.press)
    })
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const arrow = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [12, REPLY_AT], [0, 1], 'clamp'), transform: [{ scale: interpolate(x.value, [12, REPLY_AT], [0.6, 1], 'clamp') }] }))

  return (
    <GestureDetector gesture={pan}>
      <View accessibilityActions={onReply ? [{ name: 'reply', label }] : undefined} onAccessibilityAction={event => (event.nativeEvent.actionName === 'reply' ? reply() : undefined)}>
        <Animated.View pointerEvents="none" style={[styles.arrow, arrow]}>
          <View style={[styles.arrowCircle, { backgroundColor: c.tone }]}>
            <Feather name="corner-up-left" size={16} color={c.text} />
          </View>
        </Animated.View>
        <Animated.View style={row}>{children}</Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  stamp: { position: 'absolute', right: 0, width: STAMP_WIDTH, alignItems: 'flex-end' },
  arrow: { position: 'absolute', top: 0, bottom: 0, left: 0, justifyContent: 'center' },
  arrowCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
})
