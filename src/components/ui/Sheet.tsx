import { useEffect, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { haptic } from '@/lib/haptics'
import { useTheme } from '@/theme/ThemeProvider'
import { motion, radius } from '@/theme/tokens'

import { RaisedScope } from './Raised'

interface Props {
  visible: boolean
  onClose: () => void
  children: ReactNode
  /** Accessibility name for the sheet. */
  label: string
  /** Lift the sheet above the keyboard (a sheet with a text field). */
  avoidKeyboard?: boolean
}

const OPEN = { damping: 26, stiffness: 260, overshootClamping: true }

/**
 * Bottom sheet: a raised panel that slides up over a scrim. It follows your finger 1:1 when dragged down and settles back
 * with no bounce; a fling down (or a drag past 40%) closes it, as do the scrim and back.
 */
export function Sheet({ visible, onClose, children, label, avoidKeyboard = false }: Props) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const progress = useSharedValue(0)
  const drag = useSharedValue(0)
  const panelHeight = useSharedValue(420)
  // Keep the Modal mounted until the close animation finishes. Opening is derived during render
  // (React's pattern for state that follows a prop); closing is set when the animation ends.
  const [mounted, setMounted] = useState(visible)

  if (visible && !mounted) {
    setMounted(true)
  }

  useEffect(() => {
    if (visible) {
      drag.value = 0
      progress.value = reduced ? withTiming(1, { duration: 180 }) : withSpring(1, OPEN)
    } else {
      progress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) }, finished => {
        if (finished) {
          runOnJS(setMounted)(false)
        }
      })
    }
  }, [visible, progress, drag, reduced])

  const pan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-20, 20])
    .onUpdate(event => {
      // Down follows the finger; up gives a little, like paper held at the edge.
      drag.set(event.translationY > 0 ? event.translationY : event.translationY * 0.12)
    })
    .onEnd(event => {
      if (event.velocityY > motion.flingClose || drag.get() > panelHeight.get() * 0.4) {
        runOnJS(haptic)('gestureEnd')
        runOnJS(onClose)()
      } else {
        drag.set(withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }))
      }
    })

  const scrim = useAnimatedStyle(() => ({ opacity: progress.value * interpolate(drag.value, [0, panelHeight.value], [1, 0.3], 'clamp') }))
  const panel = useAnimatedStyle(() => ({
    opacity: reduced ? progress.value : 1,
    transform: [{ translateY: (reduced ? 0 : (1 - progress.value) * (panelHeight.value + 40)) + drag.value }],
  }))

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.fill}>
        <KeyboardAvoidingView style={styles.fill} behavior="padding" enabled={avoidKeyboard}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, scrim]}>
            <Pressable accessibilityLabel="Dismiss" style={styles.fill} onPress={onClose} />
          </Animated.View>
          <GestureDetector gesture={pan}>
            <Animated.View
              accessibilityViewIsModal
              accessibilityLabel={label}
              onLayout={event => {
                panelHeight.set(event.nativeEvent.layout.height)
              }}
              style={[
                styles.panel,
                { backgroundColor: c.raised, boxShadow: `inset 0 1px 0 ${c.edge}, ${c.sheetShadow}`, paddingBottom: Math.max(insets.bottom, 16) + 12 },
                panel,
              ]}
            >
              <View style={[styles.grab, { backgroundColor: c.grab }]} />
              <RaisedScope>{children}</RaisedScope>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  panel: { borderTopLeftRadius: radius.tray, borderTopRightRadius: radius.tray, paddingHorizontal: 16, paddingTop: 8 },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 16 },
})
