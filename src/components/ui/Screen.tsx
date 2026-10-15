import type { ReactNode } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  children: ReactNode
  /** Edges to inset. Pass [] for full-bleed screens (the screen viewer). */
  edges?: readonly Edge[]
  style?: StyleProp<ViewStyle>
}

/** A full-height canvas that respects the safe area. */
export function Screen({ children, edges = ['top', 'bottom'], style }: Props) {
  const { c } = useTheme()

  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: c.canvas }, style]}>
      {children}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
