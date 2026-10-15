import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { T } from '@/components/ui/T'
import type { RoomView } from '@/features/rooms/view'
import type { BotMeta } from '@/lib/hermes/identity'
import { useTheme } from '@/theme/ThemeProvider'
import { size } from '@/theme/tokens'

import { RoomFaces } from './RoomFaces'

interface Props {
  view: RoomView
  metas: Record<string, BotMeta | undefined>
  onPress: () => void
}

/** One room in the Home list: its members' faces, name, the last thing said, age, and amber if it needs you. */
export const RoomRow = memo(function RoomRow({ view, metas, onPress }: Props) {
  const { c } = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${view.name}, a room. ${view.needsYou ? 'Needs you. ' : ''}${view.preview}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.tone : 'transparent' }]}
    >
      <RoomFaces members={view.data.room.members} metas={metas} variant="row" ring={c.sheet} />
      <View style={styles.text}>
        <T variant="rowTitle" numberOfLines={1}>
          {view.name}
        </T>
        <T variant="secondary" color={view.needsYou ? 'text' : 'text2'} numberOfLines={1}>
          {view.preview || ' '}
        </T>
      </View>
      <View style={styles.meta}>
        <T variant="meta" color="text2">
          {view.age}
        </T>
        {view.needsYou ? <AttentionDot size={8} /> : <View style={styles.dotSpace} />}
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10, minHeight: size.botRow },
  text: { flex: 1, minWidth: 0, gap: 2 },
  meta: { alignItems: 'flex-end', alignSelf: 'flex-start', paddingTop: 4, gap: 8 },
  dotSpace: { width: 8, height: 8 },
})
