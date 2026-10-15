import { useEffect } from 'react'
import { Image, Modal, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconCircle } from '@/components/ui/IconCircle'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { pictureKey, usePictures } from '@/stores/pictures'
import { useViewer, type ViewTarget } from '@/stores/viewer'

const keyOf = (target: ViewTarget) => `${target.uri ?? ''}|${target.path ?? ''}|${target.profile ?? ''}`

function Picture({ target }: { target: ViewTarget }) {
  const insets = useSafeAreaInsets()
  const close = useViewer(state => state.close)
  // A picture the chat already drew is here already: the viewer shares its fetch rather than downloading it again.
  const entry = usePictures(state => (target.path && !target.uri ? state.byKey[pictureKey(target.profile, target.path)] : undefined))

  useEffect(() => {
    if (target.path && !target.uri) {
      const { path, profile } = target

      usePictures.getState().ensure(profile, path)

      return () => usePictures.getState().release(profile, path)
    }
  }, [target])

  const url = target.uri ?? (entry?.status === 'ready' ? entry.url : null)
  const error = entry?.status === 'failed' ? entry.error : !target.uri && !target.path ? 'There is nothing to show.' : null

  return (
    <View style={styles.screen}>
      {url ? <Image source={{ uri: url }} style={styles.image} resizeMode="contain" accessibilityLabel={target.name} /> : null}
      {!url && !error ? <Spinner size={18} /> : null}
      {error ? (
        <T variant="secondary" color="#D4D4D8" style={styles.error}>
          {error}
        </T>
      ) : null}
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <IconCircle icon="x" label="Close" diameter={44} onPress={close} />
      </View>
      <T variant="label" color="#D4D4D8" numberOfLines={1} style={[styles.caption, { bottom: insets.bottom + 16 }]}>
        {target.name}
      </T>
    </View>
  )
}

/** A picture, full screen on black, fetched when it is opened. Mounted once, at the root. */
export function ImageViewer() {
  const target = useViewer(state => state.target)
  const close = useViewer(state => state.close)

  return (
    <Modal visible={!!target} transparent={false} animationType="fade" onRequestClose={close} statusBarTranslucent>
      {target ? <Picture key={keyOf(target)} target={target} /> : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  error: { paddingHorizontal: 32, textAlign: 'center' },
  top: { position: 'absolute', right: 16 },
  caption: { position: 'absolute', left: 24, right: 24, textAlign: 'center' },
})
