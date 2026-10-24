import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import { replySnippet } from '@/features/transcript/reply'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** Above the field while you reply: whose message, its first line, and a way to drop the reply. */
export function ReplyStrip({ who, text, onCancel }: { who: string; text: string; onCancel: () => void }) {
  const { c } = useTheme()

  return (
    <View style={[styles.strip, { backgroundColor: c.pressedIn }]} accessibilityLabel={`Replying to ${who}: ${replySnippet(text)}`}>
      <Feather name="corner-up-left" size={14} color={c.text2} />
      <View style={styles.words}>
        <T variant="label" numberOfLines={1} style={styles.who}>
          Replying to {who}
        </T>
        <T variant="label" color="text2" numberOfLines={1}>
          {replySnippet(text)}
        </T>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Don’t reply to it" hitSlop={10} onPress={onCancel} style={styles.close}>
        <Feather name="x" size={16} color={c.text2} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.field, paddingLeft: 12, paddingRight: 6, paddingVertical: 8, marginHorizontal: 6, marginTop: 4 },
  words: { flex: 1, minWidth: 0 },
  who: { fontFamily: fonts.semibold },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
