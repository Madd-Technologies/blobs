import Feather from '@expo/vector-icons/Feather'
import { memo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Raised } from '@/components/ui/Raised'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { formatDuration, usesScreen, waitingOnYou, wording } from '@/features/transcript/activity'
import { summarizeWork, withJob } from '@/features/transcript/jobs'
import type { Item, Step } from '@/features/transcript/types'
import { fileName } from '@/features/viewer/kind'
import { openDocument, openFile } from '@/stores/documents'
import { useStepJobs } from '@/stores/sessions'
import { useNowMs } from '@/lib/useNow'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

type Activity = Extract<Item, { kind: 'activity' }>

/** Long output is trimmed to its tail: the end is what matters, and the screen is small. */
const OUTPUT_LIMIT = 4000

/** `handled`: the bot carried on after this step's run, so a failure in it is marked quietly, not in red. */
function StepRow({ step, handled }: { step: Step; handled: boolean }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const failed = step.state === 'failed'
  const red = failed && !handled
  const icon = step.state === 'blocked' ? 'slash' : failed ? 'x' : step.state === 'running' ? 'more-horizontal' : 'check'
  const output = step.output && step.output.length > OUTPUT_LIMIT ? `…${step.output.slice(-OUTPUT_LIMIT)}` : step.output
  const words = wording(step)
  const file = fileOf(step)

  return (
    <View style={styles.step}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${words.past}${step.durationS !== undefined ? `, ${formatDuration(step.durationS)}` : ''}`} disabled={!output} onPress={() => setOpen(!open)} style={styles.stepLine}>
        <Feather name={icon} size={13} color={red ? c.danger : c.text2} />
        <T variant="label" color={red ? 'danger' : 'text2'} numberOfLines={1} style={styles.flex}>
          {words.past}
        </T>
        {step.state !== 'failed' && step.exitCode ? (
          <T variant="meta" color="text2">
            {step.exitCode < 0 ? `signal ${-step.exitCode}` : `exit ${step.exitCode}`}
          </T>
        ) : null}
        {step.durationS !== undefined ? (
          <T variant="meta" color="text2">
            {formatDuration(step.durationS)}
          </T>
        ) : null}
      </Pressable>
      {step.resultLine && !open ? (
        <T variant="monoSmall" color="text2" numberOfLines={1} style={styles.result}>
          {step.resultLine}
        </T>
      ) : null}
      {open && output ? (
        <View style={[styles.output, { backgroundColor: c.sheet }]}>
          <T variant="monoSmall" selectable>
            {output}
          </T>
        </View>
      ) : null}
      {step.state !== 'running' && (step.diff || file) ? (
        <View style={styles.stepLinks}>
          {step.diff ? (
            <Pressable accessibilityRole="button" accessibilityLabel="View the changes" hitSlop={8} onPress={() => step.diff && openDocument({ kind: 'diff', diff: step.diff, name: file ? fileName(file) : 'Changes' })} style={styles.stepLink}>
              <Feather name="git-commit" size={13} color={c.text2} />
              <T variant="label" color="text2">
                View changes
              </T>
            </Pressable>
          ) : null}
          {file ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${fileName(file)}`} hitSlop={8} onPress={() => openFile(file)} style={styles.stepLink}>
              <Feather name="file-text" size={13} color={c.text2} />
              <T variant="label" color="text2">
                Open file
              </T>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** The file a step wrote (its result says) or read (its arguments say), when that is an absolute path on the server. */
function fileOf(step: Step): string | undefined {
  const asked = step.args?.path

  return step.file ?? (step.name === 'read_file' && typeof asked === 'string' && asked.startsWith('/') ? asked : undefined)
}

/**
 * Tool work as one quiet line: what it is doing now (with the clock and its last line of output), or
 * "Ran 4 steps · 1m 12s" once finished. Tap to see the steps. No boxes.
 *
 * On a server that reports live work (Hermes 0.22+), a step that returned but left work running (a background command,
 * helpers) keeps the line until that work is over: the command's newest output under it, the helpers' finished-of-started
 * count with a bar. Elsewhere the line is exactly as before.
 */
export const ActivityLine = memo(function ActivityLine({
  item,
  botName,
  profile,
  latest,
  carriedOn = false,
  onOpenScreen,
}: {
  item: Activity
  botName: string
  /** The bot whose chat this is, to follow the jobs its steps started. */
  profile?: string
  /** The newest thing in the chat. */
  latest?: boolean
  /** The bot did more after this run in the same turn, so a failure it ended on was handled. */
  carriedOn?: boolean
  onOpenScreen?: () => void
}) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const jobs = useStepJobs(profile, item.steps)
  const running = item.steps.some(step => step.state === 'running') || Object.values(jobs ?? {}).some(job => job.state === 'running')
  const now = useNowMs(running)
  const summary = summarizeWork(item.steps, jobs, now, carriedOn)
  const finished = item.steps.filter(step => step.state !== 'running' && step !== summary.current).map(step => withJob(step, jobs))
  // A job's line is only what it printed (nothing until it prints); a foreground step's is its last result line.
  const live = summary.kind !== 'running' ? undefined : summary.job ? summary.job.detail : summary.current?.resultLine
  const fraction = summary.job?.fraction
  const expandable = summary.kind !== 'running' || finished.length > 0
  const onScreen = item.steps.some(usesScreen)
  // The bot is stuck on the screen because you hold it: the one moment in a run that needs you.
  const waiting = latest && waitingOnYou(item.steps) !== undefined

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary.title}
        accessibilityState={{ expanded: open }}
        disabled={!expandable}
        onPress={() => setOpen(!open)}
        style={styles.line}
      >
        {summary.kind === 'running' ? <Spinner /> : <Feather name={summary.kind === 'failed' ? 'x' : 'check'} size={14} color={summary.kind === 'failed' ? c.danger : c.text2} />}
        <T variant="label" color={summary.kind === 'failed' ? 'danger' : summary.kind === 'running' ? 'text' : 'text2'} numberOfLines={1} style={styles.title}>
          {summary.title}
          {fraction ? (
            <T variant="label" color="text2">{` · ${fraction.done} of ${fraction.total} done`}</T>
          ) : summary.kind === 'running' && summary.elapsedS !== undefined ? (
            <T variant="label" color="text2">{` · ${formatDuration(summary.elapsedS)}`}</T>
          ) : null}
        </T>
        {expandable ? <Feather name={open ? 'chevron-down' : 'chevron-right'} size={13} color={summary.kind === 'failed' ? c.danger : c.text2} /> : null}
      </Pressable>

      {onScreen && onOpenScreen && !waiting ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${botName}'s screen`} onPress={onOpenScreen} hitSlop={10} style={styles.screenLink}>
          <Feather name="monitor" size={13} color={c.text2} />
          <T variant="label" color="text2">
            Open screen
          </T>
        </Pressable>
      ) : null}

      {waiting && onOpenScreen ? (
        <Raised radius={radius.card} rise style={styles.hold}>
          <View style={[styles.holdDot, { backgroundColor: c.needsYou }]} />
          <T variant="body" style={styles.flex}>
            {botName} is waiting. You have the screen.
          </T>
          <Pill label="Open screen" variant="primary" height={40} onPress={onOpenScreen} />
        </Raised>
      ) : null}

      {fraction ? (
        <View style={styles.bar}>
          <ProgressBar done={fraction.done} total={fraction.total} label={`${fraction.done} of ${fraction.total} done`} />
        </View>
      ) : null}

      {live ? (
        <T variant="monoSmall" color="text2" numberOfLines={1} style={styles.live}>
          {live}
        </T>
      ) : null}

      {open ? (
        <View style={styles.steps}>
          {(summary.kind === 'running' ? finished : item.steps.map(step => withJob(step, jobs))).map(step => (
            <StepRow key={step.toolId} step={step} handled={summary.kind !== 'failed'} />
          ))}
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { alignSelf: 'flex-start', maxWidth: '100%', gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, minHeight: 28 },
  title: { flexShrink: 1 },
  live: { paddingLeft: 24 },
  bar: { paddingLeft: 24, paddingTop: 2, paddingBottom: 4, width: 220, maxWidth: '100%' },
  screenLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 24, paddingVertical: 2 },
  stepLinks: { flexDirection: 'row', gap: 16, paddingLeft: 19, paddingTop: 2 },
  stepLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  hold: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16, paddingRight: 14, marginTop: 6, marginHorizontal: -4 },
  holdDot: { width: 8, height: 8, borderRadius: 4 },
  steps: { paddingLeft: 12, gap: 4, paddingTop: 2 },
  step: { gap: 2 },
  stepLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  result: { paddingLeft: 19 },
  output: { marginLeft: 19, marginTop: 2, borderRadius: radius.block, padding: 10 },
})
