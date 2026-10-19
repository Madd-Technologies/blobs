import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'

import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { rowView, type WaitingPlugin } from '@/features/restart/model'
import { useNow } from '@/lib/useNow'
import { botName, useRestart } from '@/stores/restart'
import { SERVER_PLUGINS, useServerPlugins } from '@/stores/serverPlugins'
import { useTheme } from '@/theme/ThemeProvider'
import { size } from '@/theme/tokens'

/** A plugin installed but not loaded: it loads at the next restart (Server plugins' "Restart to load"). */
export function useWaitingPlugin(): WaitingPlugin | null {
  const byName = useServerPlugins(state => state.byName)

  for (const plugin of SERVER_PLUGINS) {
    const state = byName[plugin.name]?.state

    if (state?.kind === 'restart') {
      return { title: plugin.title, version: state.version }
    }
  }

  return null
}

/** Settings → Restart Hermes: how long the dashboard has been up, or what a restart is doing (canvas row 24). */
export function RestartRow() {
  const { c } = useTheme()
  const router = useRouter()
  const status = useRestart(state => state.status)
  const phase = useRestart(state => state.phase)
  const dismissedTimeout = useRestart(state => state.dismissedTimeout)
  const waiting = useWaitingPlugin()
  const now = useNow(30)
  const view = rowView({ status, phase, waiting, now, nameOf: botName, dismissedTimeout })

  const onPress = view.opens === 'sheet' ? () => useRestart.getState().open() : view.opens === 'plugins' ? () => router.push('/plugins') : undefined

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Restart Hermes. ${view.line}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed && onPress ? c.tone : 'transparent' }]}
    >
      <View style={styles.text}>
        <T variant="body" color={view.opens || view.action ? 'text' : 'text2'} numberOfLines={1}>
          Restart Hermes
        </T>
        <View style={styles.line}>
          {view.spinner ? <Spinner size={12} /> : null}
          {view.tone === 'amber' ? <View style={[styles.dot, { backgroundColor: c.needsYou }]} /> : null}
          <T variant="label" color={view.tone === 'quiet' ? 'text2' : 'text'} numberOfLines={view.opens ? 1 : 3} style={styles.flex}>
            {view.line}
          </T>
        </View>
      </View>
      {view.action === 'cancel' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel the restart" hitSlop={10} onPress={() => void useRestart.getState().cancel()}>
          <T variant="body">Cancel</T>
        </Pressable>
      ) : view.action === 'update' ? (
        <T variant="body" color="text2">
          Update
        </T>
      ) : null}
      {onPress && view.action !== 'cancel' ? <Feather name="chevron-right" size={16} color={c.text2} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: size.row + 12, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
})
