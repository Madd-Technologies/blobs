import Feather from '@expo/vector-icons/Feather'
import { Children, isValidElement, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { useTheme } from '@/theme/ThemeProvider'
import { radius, size } from '@/theme/tokens'

import { useOnRaised } from './Raised'
import { T } from './T'

interface ListProps {
  children: ReactNode
  /** 22 for a page's groups (Settings), 20 on a bot's details, 16 inside a sheet. */
  radius?: number
  /** Inset 1 px lines between rows (Settings' groups have none). */
  separators?: boolean
}

/** A sheet of rows on the paper: one level up from the canvas, with inset 1 px separators in the tone. */
export function GroupedList({ children, radius: corner, separators = true }: ListProps) {
  const { c } = useTheme()
  const onRaised = useOnRaised()
  const rows = Children.toArray(children).filter(isValidElement)

  return (
    <View style={[styles.list, { backgroundColor: c.sheet, borderRadius: corner ?? (onRaised ? radius.list : radius.group) }]}>
      {rows.map((row, index) => (
        <View key={row.key ?? index}>
          {index > 0 && separators ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
          {row}
        </View>
      ))}
    </View>
  )
}

interface RowProps {
  label: string
  /** Quiet secondary text on the right. */
  value?: string
  /** A control (e.g. a Switch) on the right, in place of the value and chevron. */
  right?: ReactNode
  onPress?: () => void
  /** Show the › chevron. Defaults to true when the row is tappable. */
  chevron?: boolean
  /** Red label for destructive actions like "Delete bot". */
  destructive?: boolean
  disabled?: boolean
}

export function Row({ label, value, right, onPress, chevron, destructive, disabled }: RowProps) {
  const { c } = useTheme()
  const showChevron = chevron ?? (!!onPress && !right && !destructive)

  const content = (
    <>
      <T variant="body" color={destructive ? 'danger' : 'text'} style={styles.label} numberOfLines={1}>
        {label}
      </T>
      {value ? (
        <T variant="body" color="text2" numberOfLines={1} style={styles.value}>
          {value}
        </T>
      ) : null}
      {right}
      {showChevron ? <Feather name="chevron-right" size={16} color={c.text2} /> : null}
    </>
  )

  if (!onPress) {
    return <View style={styles.row}>{content}</View>
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.tone : 'transparent', opacity: disabled ? 0.4 : 1 }]}
    >
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { overflow: 'hidden' },
  separator: { height: 1, marginLeft: 16 },
  row: { minHeight: size.row, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { flex: 1 },
  value: { flexShrink: 1, maxWidth: '60%', textAlign: 'right' },
})
