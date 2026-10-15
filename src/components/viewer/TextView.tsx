import { useMemo } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Markdown } from '@/components/chat/Markdown'
import { T } from '@/components/ui/T'
import type { ViewerKind } from '@/features/viewer/kind'
import { useTheme } from '@/theme/ThemeProvider'

/** JSON indented two spaces, or the text as it came when it does not parse. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** The most lines drawn: a log of a million lines would only make the phone slow, and the start says what it is. */
const MAX_LINES = 5000

/**
 * A text file: markdown drawn as the chat draws it, anything else as it is in mono, scrolling both ways so lines keep their shape
 * (code, logs, tables in CSV). Selectable, to copy a part.
 */
export function TextView({ text, kind }: { text: string; kind: ViewerKind }) {
  const { c } = useTheme()
  const shown = useMemo(() => {
    const body = kind === 'json' ? pretty(text) : text
    const lines = body.split('\n')

    return lines.length > MAX_LINES ? `${lines.slice(0, MAX_LINES).join('\n')}\n…` : body
  }, [text, kind])

  if (kind === 'markdown') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Markdown text={shown} />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.block, { backgroundColor: c.sheet }]}>
          <T variant="monoSmall" selectable>
            {shown}
          </T>
        </View>
      </ScrollView>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 },
  block: { borderRadius: 8, padding: 12, minWidth: '100%' },
})
