import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import { diagramKind } from '@/lib/hermes/diagram'
import { useDiagram } from '@/stores/diagram'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * A diagram in a reply, as a quiet tile: what kind it is, and that it opens. Drawing a diagram takes a whole web page (and several
 * megabytes of library), so it is drawn when you ask, full screen, not in the middle of the chat.
 */
export function DiagramTile({ source }: { source: string }) {
  const { c } = useTheme()
  const kind = diagramKind(source)

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${kind}. Open`} onPress={() => useDiagram.getState().open(source)} style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? c.tone : c.sheet }]}>
      <Feather name="git-branch" size={18} color={c.text2} />
      <View style={styles.text}>
        <T variant="rowTitle">{kind}</T>
        <T variant="meta" color="text2">
          Tap to open
        </T>
      </View>
      <Feather name="maximize-2" size={16} color={c.text2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // A bubble is as wide as its content, and flex: 1 counts as no width in it: the tile has a width of its own.
  tile: { minWidth: 230, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  text: { flexGrow: 1, flexShrink: 1, gap: 1 },
})
