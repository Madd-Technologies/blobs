import Feather from '@expo/vector-icons/Feather'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import { KEY, type Modifier } from '@/features/display/keys'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

interface Props {
  /** Modifiers held for the next key (sticky: they let go after it). */
  modifiers: Modifier[]
  onToggleModifier: (modifier: Modifier) => void
  onKey: (keysym: number) => void
}

/**
 * The keys a phone keyboard lacks, for driving a desktop: one quiet row above the keyboard, mono labels. It is
 * wider than a phone, so it scrolls sideways. Backspace and the letters come from the keyboard itself. Enter is here
 * too: not every keyboard offers one for this field (some show none for it).
 * Keys act on release (not touch-down) so that a swipe to scroll the row never presses the key it started on.
 */
export function KeysBar({ modifiers, onToggleModifier, onKey }: Props) {
  const { c } = useTheme()

  const key = (label: string, keysym: number) => (
    <Pressable key={label} onPress={() => onKey(keysym)} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.key, { backgroundColor: c.tone, opacity: pressed ? 0.7 : 1 }]}>
      <T variant="label" style={styles.mono}>
        {label}
      </T>
    </Pressable>
  )

  const modifier = (label: Modifier) => {
    const on = modifiers.includes(label)

    return (
      <Pressable
        key={label}
        onPress={() => onToggleModifier(label)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        style={[styles.key, { backgroundColor: on ? c.primary : c.tone }]}
      >
        <T variant="label" color={on ? 'onPrimary' : 'text'} style={[styles.mono, on && styles.on]}>
          {label}
        </T>
      </Pressable>
    )
  }

  const arrow = (icon: 'chevron-left' | 'chevron-up' | 'chevron-down' | 'chevron-right', label: string, keysym: number) => (
    <Pressable key={label} onPress={() => onKey(keysym)} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.arrow, { backgroundColor: c.tone, opacity: pressed ? 0.7 : 1 }]}>
      <Feather name={icon} size={16} color={c.text} />
    </Pressable>
  )

  return (
    <View style={[styles.bar, { backgroundColor: c.canvas, borderTopColor: c.hairline }]} accessibilityLabel="Extra keys">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.row}>
        {key('enter', KEY.Return)}
        {key('esc', KEY.Escape)}
        {key('tab', KEY.Tab)}
        {modifier('ctrl')}
        {modifier('alt')}
        {modifier('super')}
        <View style={[styles.rule, { backgroundColor: c.tone }]} />
        {arrow('chevron-left', 'Left arrow', KEY.Left)}
        {arrow('chevron-up', 'Up arrow', KEY.Up)}
        {arrow('chevron-down', 'Down arrow', KEY.Down)}
        {arrow('chevron-right', 'Right arrow', KEY.Right)}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { height: 52, borderTopWidth: StyleSheet.hairlineWidth },
  row: { alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  key: { height: 36, minWidth: 52, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  arrow: { height: 36, width: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: fonts.mono, fontSize: 13 },
  on: { fontFamily: fonts.monoMedium },
  rule: { width: 1, height: 22, marginHorizontal: 6 },
})
