import { FlatList, Pressable, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import type { SlashOption } from '@/lib/hermes/slash'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  options: SlashOption[]
  onPick: (option: SlashOption) => void
}

const ROW = 52

/** The commands and skills that match what is typed after the slash, in a quiet list above the message box. */
export function SlashPicker({ options, onPick }: Props) {
  const { c } = useTheme()

  return (
    <View style={[styles.sheet, { backgroundColor: c.sheet, maxHeight: ROW * 4.5 + 8 }]} accessibilityLabel="Commands">
      <FlatList
        data={options}
        keyExtractor={option => option.name}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}${item.hint ? ` ${item.hint}` : ''}. ${item.description}`} onPress={() => onPick(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.tone }]}>
            <T variant="mono" numberOfLines={1}>
              {item.name}
              {item.hint ? (
                <T variant="mono" color="text2">
                  {` ${item.hint}`}
                </T>
              ) : null}
            </T>
            <T variant="meta" color="text2" numberOfLines={1}>
              {item.description.replace(/`/g, '')}
            </T>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 12, borderRadius: 22, overflow: 'hidden' },
  list: { paddingVertical: 4 },
  row: { height: ROW, paddingHorizontal: 16, justifyContent: 'center', gap: 2 },
})
