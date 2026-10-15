import { memo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import { isDozing, motionFor } from '@/features/face/motion'
import type { BotView } from '@/features/roster/view'
import { useTheme } from '@/theme/ThemeProvider'
import { size } from '@/theme/tokens'

import { AttentionDot } from './AttentionDot'
import { BotFace } from './BotFace'

interface Props {
  view: BotView
  onPress: () => void
}

/** One bot in the list: face, name, one line of what is going on, age, and amber if it needs you. */
export const BotRow = memo(function BotRow({ view, onPress }: Props) {
  const { c } = useTheme()
  const needsYou = view.attention.state === 'needsYou'
  // The face squishes as you press the row.
  const [poke, setPoke] = useState(0)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${view.name}. ${needsYou ? 'Needs you. ' : ''}${view.preview}`}
      onPress={onPress}
      onPressIn={() => setPoke(count => count + 1)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.tone : 'transparent' }]}
    >
      <BotFace name={view.profile} meta={view.meta} size={44} mood={view.mood} motion={motionFor({ needsYou, working: view.attention.state === 'working', dozing: isDozing(view.lastActive) }, 'still')} poke={poke} />
      <View style={styles.text}>
        <T variant="rowTitle" numberOfLines={1}>
          {view.name}
        </T>
        <T variant="secondary" color={view.urgent ? 'text' : 'text2'} numberOfLines={1}>
          {view.preview || ' '}
        </T>
      </View>
      <View style={styles.meta}>
        <T variant="meta" color="text2">
          {view.age}
        </T>
        {needsYou ? <AttentionDot size={8} /> : <View style={styles.dotSpace} />}
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
