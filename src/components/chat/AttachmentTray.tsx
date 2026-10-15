import Feather from '@expo/vector-icons/Feather'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { T } from '@/components/ui/T'
import { describeSize, type PendingFile } from '@/lib/hermes/attachments'
import { useTheme } from '@/theme/ThemeProvider'

interface Props {
  files: PendingFile[]
  onRemove: (id: string) => void
}

/** What is about to be sent with your message: a thumbnail for a picture, a name and size for anything else. */
export function AttachmentTray({ files, onRemove }: Props) {
  const { c } = useTheme()

  if (!files.length) {
    return null
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={styles.scroll} contentContainerStyle={styles.row}>
      {files.map(file => (
        <View key={file.id} style={[styles.item, { backgroundColor: c.tone }]}>
          {file.kind === 'image' ? (
            <Image source={{ uri: file.uri }} style={styles.thumb} resizeMode="cover" accessibilityLabel={file.name} />
          ) : (
            <View style={styles.file}>
              <Feather name={file.kind === 'pdf' ? 'file-text' : 'file'} size={18} color={c.text2} />
              <View style={styles.fileText}>
                <T variant="label" numberOfLines={1} style={styles.fileName}>
                  {file.name}
                </T>
                {file.size !== undefined ? (
                  <T variant="meta" color="text2">
                    {describeSize(file.size)}
                  </T>
                ) : null}
              </View>
            </View>
          )}
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`} hitSlop={10} onPress={() => onRemove(file.id)} style={[styles.remove, { backgroundColor: c.canvas }]}>
            <Feather name="x" size={12} color={c.text} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  item: { borderRadius: 10, overflow: 'visible' },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  file: { height: 64, maxWidth: 200, minWidth: 120, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileText: { flexShrink: 1 },
  fileName: { flexShrink: 1 },
  remove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
