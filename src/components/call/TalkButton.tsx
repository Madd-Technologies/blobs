import Feather from '@expo/vector-icons/Feather'
import { StyleSheet, View } from 'react-native'

import { Press } from '@/components/ui/Press'
import { useOnRaised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import type { CallSnapshot } from '@/features/call/engine'
import { talkLabel } from '@/features/call/talk'
import { useCall } from '@/stores/call'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

interface Props {
  call: CallSnapshot
  /** A card waits for you: its answer has the white pill, so this one is pressed in. */
  quiet?: boolean
  /** The chat's call bar: a 44 circle instead of the tray's wide pill. */
  compact?: boolean
}

/**
 * The walkie-talkie's talk button: hold to talk and let go to send, or tap once to keep talking and tap again to send. Its
 * state lives in the call store, so the call screen and the chat's call bar are the same button.
 */
export function TalkButton({ call, quiet, compact }: Props) {
  const { c } = useTheme()
  const onRaised = useOnRaised()
  const hold = useCall(state => state.hold)
  const live = call.phase === 'live'
  const on = hold !== 'idle'
  const label = talkLabel(hold, call.line === 'opening')
  // White while it is the thing to do (or while you talk); pressed in while a card waits for your tap.
  const filled = on || !quiet
  const bg = filled ? c.primary : onRaised ? c.pressedIn : c.control
  const fg = filled ? c.onPrimary : c.text

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Hold to talk, or tap to keep talking and tap again to send."
      accessibilityState={{ disabled: !live, selected: on }}
      disabled={!live}
      onPressIn={() => useCall.getState().pressTalk()}
      onPressOut={() => useCall.getState().releaseTalk()}
      hitSlop={compact ? 0 : undefined}
      style={[compact ? styles.circle : styles.pill, { backgroundColor: bg, opacity: live ? 1 : 0.4 }]}
    >
      <Feather name={hold === 'locked' ? 'send' : 'mic'} size={compact ? 20 : 18} color={fg} />
      {compact ? null : (
        <View style={styles.words}>
          <T variant="body" color={fg} numberOfLines={1} style={styles.label}>
            {label}
          </T>
        </View>
      )}
    </Press>
  )
}

const styles = StyleSheet.create({
  pill: { flex: 2, height: 52, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  circle: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  words: { flexShrink: 1 },
  label: { fontFamily: fonts.semibold },
})
