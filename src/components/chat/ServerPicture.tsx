import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { isRemote } from '@/lib/hermes/media'
import { shownHeight } from '@/lib/hermes/pictureCache'
import { pictureKey, usePictures } from '@/stores/pictures'
import { useViewer } from '@/stores/viewer'
import { useRowVisible } from './RowContext'
import { useTheme } from '@/theme/ThemeProvider'

/** How wide a picture a bot sent is drawn in the chat. */
export const PICTURE_WIDTH = 260

interface Props {
  /** A file on the server, or an https address (a picture a tool made on the web). */
  path: string
  name: string
  profile?: string
  /** A path the bot only mentioned: if it cannot be loaded, show nothing rather than an error. */
  quiet?: boolean
}

/**
 * A picture a bot sent, drawn in the chat as soon as it is on screen (fetched from the server, kept so scrolling back is
 * instant). It opens full screen when tapped. While it loads there is a quiet block of the same width; if it cannot be loaded the
 * picture is a named chip that tries again when tapped.
 */
export function ServerPicture({ path, name, profile, quiet }: Props) {
  const { c } = useTheme()
  const key = pictureKey(profile, path)
  const entry = usePictures(state => state.byKey[key])
  const open = useViewer(state => state.open)
  const remote = isRemote(path)
  // A picture on the web is not kept by the store, so it remembers its own shape.
  const [remoteRatio, setRemoteRatio] = useState<number | undefined>()
  const url = remote ? path : entry?.status === 'ready' ? entry.url : null

  // Fetched only while its row is on screen: a bot's picture can be megabytes, and a long chat has many.
  const visible = useRowVisible()

  useEffect(() => {
    if (!remote && visible) {
      usePictures.getState().ensure(profile, path)

      return () => usePictures.getState().release(profile, path)
    }
  }, [profile, path, remote, visible])

  // The shape of the picture sets the shape of the block, so the chat does not jump when it arrives.
  useEffect(() => {
    if (url) {
      Image.getSize(
        url,
        (width, height) => (remote ? setRemoteRatio(width / height) : usePictures.getState().setRatio(key, width / height)),
        () => undefined,
      )
    }
  }, [url, key, remote])

  if (entry?.status === 'failed') {
    if (quiet) {
      return null
    }

    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}. ${entry.error} Tap to try again.`} onPress={() => usePictures.getState().retry(profile, path)} style={[styles.failed, { backgroundColor: c.tone }]}>
        <Feather name="image" size={14} color={c.text2} />
        <T variant="label" color="text2" numberOfLines={2} style={styles.failedText}>
          {name} · {entry.error}
        </T>
      </Pressable>
    )
  }

  const height = shownHeight(PICTURE_WIDTH, remote ? remoteRatio : entry?.status === 'ready' ? entry.ratio : undefined)

  return url ? (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open ${name}`} onPress={() => open(remote ? { name, uri: path } : { name, path, profile })}>
      <Image source={{ uri: url }} style={[styles.picture, { height, backgroundColor: c.tone }]} resizeMode="cover" />
    </Pressable>
  ) : (
    <View style={[styles.picture, styles.loading, { height, backgroundColor: c.tone }]} accessibilityLabel={`Loading ${name}`}>
      <Spinner size={16} />
    </View>
  )
}

const styles = StyleSheet.create({
  picture: { width: PICTURE_WIDTH, borderRadius: 16 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  failed: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  failedText: { flexShrink: 1 },
})
