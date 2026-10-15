import { useEffect } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useToast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, raisedStyle } from '@/theme/tokens'

import { T } from './T'

const SHOW_MS = 2600
/** A toast with a button (Undo) stays long enough to reach it. */
const ACTION_MS = 5000

/** Renders the current toast above everything: a raised pill near the bottom (it may carry an Undo). */
export function ToastHost() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { message, action, nonce, hide } = useToast()

  useEffect(() => {
    if (!message) {
      return
    }

    const timer = setTimeout(hide, action ? ACTION_MS : SHOW_MS)

    return () => clearTimeout(timer)
  }, [message, action, nonce, hide])

  if (!message) {
    return null
  }

  return (
    <Animated.View
      key={nonce}
      entering={FadeInDown.duration(160)}
      exiting={FadeOut.duration(140)}
      pointerEvents={action ? 'box-none' : 'none'}
      accessibilityLiveRegion="polite"
      style={[styles.toast, action && styles.withAction, { ...raisedStyle(c), bottom: Math.max(insets.bottom, 12) + 72 }]}
    >
      <T variant="secondary" style={action ? styles.flexText : undefined}>
        {message}
      </T>
      {action ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => {
            hide()
            action.run()
          }}
        >
          <T variant="secondary" style={styles.action}>
            {action.label}
          </T>
        </Pressable>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', alignSelf: 'center', maxWidth: '86%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  withAction: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flexText: { flexShrink: 1 },
  action: { fontFamily: fonts.semibold },
})
