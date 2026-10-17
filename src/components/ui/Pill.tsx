import Feather from '@expo/vector-icons/Feather'
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

import { Press } from './Press'
import { useOnRaised } from './Raised'
import { T } from './T'

/** `danger` is red text with no fill; `destructive` is a filled pill with red text (confirming a delete). */
export type PillVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive'
export type FeatherName = React.ComponentProps<typeof Feather>['name']

interface Props {
  label: string
  onPress?: () => void
  /** `primary` is the single white pill for the next thing to do; use it once per moment. */
  variant?: PillVariant
  icon?: FeatherName
  loading?: boolean
  disabled?: boolean
  /** 36 small (14 600, in a panel or the Needs-you card), 40-46 standard, 52 for a sheet's confirm. */
  height?: 36 | 40 | 42 | 44 | 46 | 48 | 52
  /** Fill the row (equal-width pills in an action card). */
  flex?: boolean
  /**
   * Let a long label wrap onto more lines instead of cutting it off: for words a bot wrote (a question's choices). One
   * line looks like any pill; more lines keep the same end radius, so it reads as a rounded card.
   */
  wrap?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}

/**
 * A pill button. The secondary is pressed in: inside a raised card or the composer tray it is the level below its
 * container, on the canvas it sits one level up like the icon circles. Pressing sinks it on a spring.
 */
export function Pill({ label, onPress, variant = 'secondary', icon, loading, disabled, height = 42, flex, wrap, style, accessibilityLabel }: Props) {
  const { c } = useTheme()
  const onRaised = useOnRaised()
  const small = height <= 36
  const filled = variant === 'primary' || variant === 'secondary' || variant === 'destructive'
  const tray = onRaised ? c.pressedIn : c.control
  const bg = variant === 'primary' ? c.primary : variant === 'secondary' || variant === 'destructive' ? tray : 'transparent'
  const fg = variant === 'primary' ? c.onPrimary : variant === 'danger' || variant === 'destructive' ? c.danger : c.text
  const inactive = disabled || loading
  const weight = variant === 'primary' || small ? fonts.semibold : fonts.medium

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.base, wrap ? { minHeight: height, borderRadius: height / 2, paddingVertical: 10, maxWidth: '100%' } : { height }, { backgroundColor: bg, paddingHorizontal: filled ? (small ? 18 : 20) : 12, opacity: inactive && !loading ? 0.4 : 1 }, flex && styles.flex, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={[styles.content, wrap && styles.shrink]}>
          {icon ? <Feather name={icon} size={small ? 15 : 17} color={fg} /> : null}
          <T variant={small ? 'secondary' : 'body'} color={fg} style={[{ fontFamily: weight }, wrap && styles.wrapped]} numberOfLines={wrap ? undefined : 1}>
            {label}
          </T>
        </View>
      )}
    </Press>
  )
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  flex: { flex: 1 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  wrapped: { flexShrink: 1, textAlign: 'center' },
})
