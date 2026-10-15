import Feather from '@expo/vector-icons/Feather'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Pressable, Share, StyleSheet, View } from 'react-native'

import { plainText } from '@/features/transcript/markdown'
import { splitMedia } from '@/lib/hermes/media'
import { useSpeech } from '@/stores/speech'
import { useTheme } from '@/theme/ThemeProvider'

type Icon = keyof typeof Feather.glyphMap

function Action({ icon, label, onPress, disabled }: { icon: Icon; label: string; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme()

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={10} style={({ pressed }) => [styles.action, { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }]}>
      <Feather name={icon} size={16} color={c.text2} />
    </Pressable>
  )
}

/**
 * Under the bot's last reply of a turn: copy it, read it aloud, share it, and (on the latest turn) ask again. Plain icons, no labels,
 * in the quiet text color: they are there when wanted and out of the way otherwise.
 */
export function ReplyActions({ id, text, onRetry }: { id: string; text: string; /** Only on the latest turn: drop this reply and ask again. */ onRetry?: () => void }) {
  const speaking = useSpeech(state => state.speaking === id)
  const [copied, setCopied] = useState(false)
  // What was said, without the MEDIA: lines that are plumbing for the app (the files show as chips).
  const words = splitMedia(text).text

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = setTimeout(() => setCopied(false), 1500)

    return () => clearTimeout(timer)
  }, [copied])

  return (
    <View style={styles.row}>
      <Action
        icon={copied ? 'check' : 'copy'}
        label={copied ? 'Copied' : 'Copy reply'}
        onPress={() => {
          void Clipboard.setStringAsync(words)
          setCopied(true)
        }}
      />
      <Action icon={speaking ? 'square' : 'volume-2'} label={speaking ? 'Stop reading aloud' : 'Read aloud'} onPress={() => (speaking ? useSpeech.getState().stop() : useSpeech.getState().read(id, words))} />
      {/* Copy keeps the markdown (it pastes into notes and keeps code as code); sharing goes to apps that would show the marks. */}
      <Action icon="share" label="Share reply" onPress={() => void Share.share({ message: plainText(words) }).catch(() => undefined)} />
      {onRetry ? <Action icon="rotate-ccw" label="Retry: ask again for a new reply" onPress={onRetry} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 2, paddingTop: 2 },
  action: { width: 36, height: 30, alignItems: 'center', justifyContent: 'center' },
})
