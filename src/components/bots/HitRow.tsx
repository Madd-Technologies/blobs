import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import type { BotMeta } from '@/lib/hermes/identity'
import { snippetParts, type SessionHit } from '@/lib/hermes/search'
import { useTheme } from '@/theme/ThemeProvider'

import { BotFace } from './BotFace'

interface Props {
  hit: SessionHit
  name: string
  meta: BotMeta | undefined
  /** The chat's own title when it is a side chat, so two chats of one bot can be told apart. */
  chatTitle: string
  age: string
  onOpen: (hit: SessionHit) => void
}

/** A message a search found: whose chat it is in, the words around the match with the match itself brighter, and when. */
export const HitRow = memo(function HitRow({ hit, name, meta, chatTitle, age, onOpen }: Props) {
  const { c } = useTheme()
  const parts = snippetParts(hit.snippet)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${chatTitle ? `, ${chatTitle}` : ''}. ${parts.map(part => part.text).join('')}`}
      onPress={() => onOpen(hit)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.tone : 'transparent' }]}
    >
      <BotFace name={hit.profile} meta={meta} size={36} />
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
