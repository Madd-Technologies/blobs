import Feather from '@expo/vector-icons/Feather'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BotFace } from '@/components/bots/BotFace'
import { IconCircle } from '@/components/ui/IconCircle'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { useNowMs } from '@/lib/useNow'
import { useBotViews } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { useRestart } from '@/stores/restart'
import { useTheme } from '@/theme/ThemeProvider'

/** After this long the screen says Hermes has not come back yet (it still keeps trying). */
const SLOW_S = 180

/** "and" between the last two names. */
const joined = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/** "12 s", "3 min". */
const elapsed = (seconds: number) => (seconds < 60 ? `${Math.max(1, Math.floor(seconds))} s` : `${Math.floor(seconds / 60)} min`)

/**
 * The calm screen while Hermes restarts at this app's request and its connection is down (canvas row 24): sleeping faces,
 * what is happening, and the reconnect. Nothing rises: nothing needs you. Lives at the app's root.
 */
export function RestartingScreen() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const phase = useRestart(state => state.phase)
  const hidden = useRestart(state => state.overlayHidden)
  const offline = useConnection(state => state.status !== 'online')
  const host = useConnection(state => state.config?.baseUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '') ?? 'your server')
  const views = useBotViews()
  const showing = phase.kind === 'restarting' && offline && !hidden
  const nowMs = useNowMs(showing, 1000)

  if (!showing || phase.kind !== 'restarting') {
    return null
  }

  const seconds = nowMs / 1000 - phase.since
  const slow = seconds > SLOW_S

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen, { backgroundColor: c.canvas, paddingTop: insets.top + 8 }]} accessibilityViewIsModal>
      <View style={styles.back}>
        <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => useRestart.getState().hideOverlay()} />
      </View>
      <View style={styles.center}>
        <View style={styles.faces}>
          {views.slice(0, 5).map(view => (
            <BotFace key={view.profile} name={view.profile} meta={view.meta} size={40} mood="off" />
          ))}
        </View>
        <T variant="title" style={styles.centered} accessibilityRole="header">
          {slow ? 'Hermes hasn’t come back yet' : 'Restarting Hermes…'}
        </T>
        <T variant="secondary" color="text2" style={styles.centered}>
          {slow
            ? 'It may need a hand where it runs. Still trying.'
            : `${phase.choice === 'both' ? 'The dashboard and the gateway are' : 'The dashboard is'} starting again. The app reconnects by itself, usually within a minute.`}
        </T>
        <View style={styles.lines}>
          {phase.waited.length && !slow ? (
            <View style={styles.line}>
              <Feather name="check" size={14} color={c.text2} />
              <T variant="label" color="text2">
                {joined(phase.waited)} finished first
              </T>
            </View>
          ) : null}
          <View style={styles.line}>
            <Spinner size={12} />
            <T variant="label" color="text2">
              Reconnecting to {host} · {elapsed(seconds)}
            </T>
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { zIndex: 50 },
  back: { paddingLeft: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12, marginBottom: 80 },
  faces: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  centered: { textAlign: 'center' },
  lines: { gap: 8, alignItems: 'center', marginTop: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
})
