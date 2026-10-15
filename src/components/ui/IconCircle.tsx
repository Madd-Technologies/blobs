import Feather from '@expo/vector-icons/Feather'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/ThemeProvider'
import { radius, size } from '@/theme/tokens'

import type { FeatherName } from './Pill'
import { Press } from './Press'
import { useOnRaised } from './Raised'

interface Props {
  icon: FeatherName
  /** Required: an icon-only control needs a name for screen readers. */
  label: string
  onPress?: () => void
  /** 32 a panel's ⋯, 40 header buttons, 44 composer buttons, 52 action buttons. */
  diameter?: 32 | 40 | 44 | 52
  /** Muted icon (the server button) instead of full-strength. */
  muted?: boolean
  /** White fill with a dark glyph: the primary moment (stop while the bot works, send). */
  filled?: boolean
  /** No background (a bare back chevron). */
  bare?: boolean
  /** A small status dot, e.g. connected (bottom-right) or something needs you (top-right). */
  dot?: string
  dotAt?: 'top' | 'bottom'
  disabled?: boolean
  /** Glyph size; defaults by diameter (18 in a header, 20 in the composer, 22 for a bare back chevron). */
  iconSize?: number
  style?: StyleProp<ViewStyle>
}

/**
 * The round icon button used in headers and the composer: one level up from the canvas, or pressed in inside the raised
 * tray. It sinks on a spring when pressed. The tap area is never under 44.
 */
export function IconCircle({ icon, label, onPress, diameter = size.iconCircle, muted, filled, bare, dot, dotAt = 'bottom', disabled, iconSize, style }: Props) {
  const { c } = useTheme()
  const onRaised = useOnRaised()
  const bg = bare ? 'transparent' : filled ? c.primary : onRaised ? c.pressedIn : c.control
  const fg = filled ? c.onPrimary : muted ? c.text2 : c.text
  const hit = Math.max(0, (44 - diameter) / 2)
  const glyph = iconSize ?? (bare && icon === 'chevron-left' ? 22 : diameter >= 44 ? 20 : diameter <= 32 ? 16 : 18)

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hit}
      style={[styles.base, { width: diameter, height: diameter, backgroundColor: bg, opacity: disabled ? 0.4 : 1 }, style]}
    >
      <Feather name={icon} size={glyph} color={fg} />
      {dot ? <View style={[styles.dot, dotAt === 'top' ? styles.dotTop : styles.dotBottom, { backgroundColor: dot, borderColor: c.canvas }]} /> : null}
    </Press>
  )
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  // The ring is the canvas color so the dot reads as cut out of the button.
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  dotBottom: { right: 1, bottom: 1 },
  dotTop: { right: 1, top: 1, width: 10, height: 10 },
})
