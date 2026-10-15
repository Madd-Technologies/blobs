import { useMemo } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import { parseDiff, type DiffLine } from '@/features/viewer/diff'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * What an edit changed: the file, then each hunk with removed lines and added lines on a faint wash of red and green and a
 * `−`/`+` in the margin, the rest quiet. One column of mono, scrolling sideways as a whole so lines keep their indentation.
 */
export function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => parseDiff(diff), [diff])

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wide}>
      <FlatList data={lines} keyExtractor={(_, index) => String(index)} renderItem={({ item }) => <Line line={item} />} contentContainerStyle={styles.list} initialNumToRender={60} />
    </ScrollView>
  )
}

function Line({ line }: { line: DiffLine }) {
  const { c } = useTheme()

  if (line.kind === 'file') {
    return (
      <T variant="label" style={styles.file} numberOfLines={1}>
        {line.text}
      </T>
    )
  }

  if (line.kind === 'hunk') {
    return (
      <T variant="monoSmall" color="text2" style={styles.hunk} numberOfLines={1}>
        {line.text ? `@@ ${line.text}` : '@@'}
      </T>
    )
  }

  const wash = line.kind === 'add' ? c.connected : line.kind === 'remove' ? c.danger : null
  const number = line.kind === 'add' ? line.new : line.old

  return (
    <View style={[styles.line, wash ? { backgroundColor: `${wash}22` } : null]}>
      <T variant="monoSmall" color="text2" style={styles.number}>
        {number ?? ''}
      </T>
      <T variant="monoSmall" color={line.kind === 'context' ? 'text2' : 'text'} style={styles.mark}>
        {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
      </T>
      <T variant="monoSmall" color={line.kind === 'context' ? 'text2' : 'text'} selectable>
        {line.text || ' '}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  wide: { minWidth: '100%' },
  list: { paddingBottom: 40, minWidth: '100%' },
  file: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  hunk: { paddingHorizontal: 16, paddingVertical: 6 },
  line: { flexDirection: 'row', paddingRight: 16 },
  number: { width: 44, textAlign: 'right', paddingRight: 8 },
  mark: { width: 14 },
})
