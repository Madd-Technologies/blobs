import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  /** 8 in rows; 12 on a pinned face. */
  size?: 8 | 12
  /** Cut the dot out of what it overlaps with a canvas-colored ring (pinned faces). */
  ring?: boolean
  style?: StyleProp<ViewStyle>
}

/** Amber: it is this bot's turn (a prompt waits for you). Amber never means anything else. */
export function AttentionDot({ size = 8, ring, style }: Props) {
  const { c } = useTheme()

  return (
    <View
      aria-hidden
      style={[
        styles.dot,
        { width: size, height: size, backgroundColor: c.needsYou },
        ring && { borderWidth: 2.5, borderColor: c.canvas, width: size + 5, height: size + 5, borderRadius: (size + 5) / 2 },
        style,
      ]}
    />
  )
}

const styles = StyleSheet.create({ dot: { borderRadius: 999 } })
