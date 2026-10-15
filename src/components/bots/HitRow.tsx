import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import type { BotMeta } from '@/lib/hermes/identity'
import { snippetParts } from '@/lib/hermes/search'
import { useTheme } from '@/theme/ThemeProvider'

import { BotFace } from './BotFace'

interface Props {
  profile: string
  name: string
  meta: BotMeta | undefined
  /** The chat's own title when it is a side chat, so two chats of one bot can be told apart. */
  chatTitle: string
  snippet: string
  age: string
  onPress: () => void
}

/** A message a search found: whose chat it is in, the words around the match with the match itself brighter, and when. */
export const HitRow = memo(function HitRow({ profile, name, meta, chatTitle, snippet, age, onPress }: Props) {
  const { c } = useTheme()
  const parts = snippetParts(snippet)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${chatTitle ? `, ${chatTitle}` : ''}. ${parts.map(part => part.text).join('')}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.tone : 'transparent' }]}
    >
      <BotFace name={profile} meta={meta} size={36} />
      <View style={styles.text}>
        <T variant="rowTitle" numberOfLines={1}>
          {chatTitle ? `${name} · ${chatTitle}` : name}
        </T>
        <T variant="secondary" color="text2" numberOfLines={2}>
          {parts.map((part, index) =>
            part.hit ? (
              <T key={index} variant="secondary" color="text">
                {part.text}
              </T>
            ) : (
              part.text
            ),
          )}
        </T>
      </View>
      <T variant="meta" color="text2" style={styles.age}>
        {age}
      </T>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 20, paddingVertical: 10, minHeight: 56 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  age: { paddingTop: 3 },
})
