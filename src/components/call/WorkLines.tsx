import Feather from '@expo/vector-icons/Feather'
import { StyleSheet, View } from 'react-native'

import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { CallWork, WorkLine } from '@/features/call/work'
import { formatDuration } from '@/features/transcript/activity'
import { useNowMs } from '@/lib/useNow'
import { useTheme } from '@/theme/ThemeProvider'

function Line({ line, now }: { line: WorkLine; now: number }) {
  const { c } = useTheme()
  const running = line.state === 'running'
  const seconds = running ? (line.startedAt !== undefined ? (now - line.startedAt) / 1000 : undefined) : line.durationS

  return (
    <View style={styles.line}>
      {running ? <Spinner size={12} /> : <Feather name={line.state === 'failed' ? 'x' : line.state === 'blocked' ? 'slash' : 'check'} size={14} color={c.text2} />}
      <T variant="label" color={running ? 'text' : 'text2'} numberOfLines={1} style={styles.text}>
        {line.text}
      </T>
      {seconds !== undefined ? (
        <T variant="label" color="text2">
          · {formatDuration(seconds)}
        </T>
      ) : null}
    </View>
  )
}

/** The work the call handed to the bot, under the caption: one quiet line per step while it runs, then one line for all of it. */
export function WorkLines({ work }: { work: CallWork }) {
  const { c } = useTheme()
  const ticking = work.kind === 'running' && work.lines.some(line => line.state === 'running')
  const now = useNowMs(ticking)

  if (work.kind === 'done') {
    return (
      <View style={[styles.line, styles.center]}>
        <Feather name={work.failed ? 'x' : 'check'} size={14} color={c.text2} />
        <T variant="label" color="text2" numberOfLines={1}>
          {work.summary}
        </T>
      </View>
    )
  }

  return (
    <View style={styles.lines}>
      {work.lines.map(line => (
        <Line key={line.id} line={line} now={now} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  lines: { alignSelf: 'stretch', gap: 6, paddingHorizontal: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { alignSelf: 'center' },
  text: { flexShrink: 1 },
})
