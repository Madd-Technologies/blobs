import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import {
  askWhyDraft,
  durationLabel,
  failedLine,
  isOn,
  jobState,
  lastRunFailed,
  NEW_ROUTINE_DRAFT,
  routineLine,
  runOutcome,
  sortJobs,
  whenLabel,
  type CronJob,
  type CronRun,
} from '@/lib/hermes/cron'
import { chatInStack } from '@/lib/stack'
import { useNow } from '@/lib/useNow'
import { useBotView } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { useDrafts } from '@/stores/drafts'
import { removeRoutine, runKey, runRoutineNow, setRoutineOn, useRoutines } from '@/stores/routines'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** A bot's routines: when each runs, how the last runs went, and what you can do about them. */
export default function BotRoutines() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { c } = useTheme()
  const view = useBotView(profile)
  const online = useConnection(state => state.status === 'online')
  const state = useRoutines(store => store.byBot[profile])
  const nowS = useNow(30)
  const now = useMemo(() => new Date(nowS * 1000), [nowS])
  // Routines you opened by hand; one that failed is open until you say otherwise.
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  // Switches move at once and settle on the server's answer.
  const [pendingOn, setPendingOn] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<CronJob | null>(null)
  // The server switches a paused routine back on when it is run, so that is asked first.
  const [runningPaused, setRunningPaused] = useState<CronJob | null>(null)
  const name = view?.name ?? profile

  useEffect(() => {
    if (online) {
      void useRoutines.getState().load(profile)
    }
  }, [online, profile])

  const jobs = useMemo(() => sortJobs(state?.jobs ?? []), [state?.jobs])

  async function toggle(job: CronJob, on: boolean) {
    setPendingOn(current => ({ ...current, [job.id]: on }))
    const error = await setRoutineOn(profile, job.id, on)
    setPendingOn(current => {
      const { [job.id]: _settled, ...rest } = current

      return rest
    })

    if (error) {
      toast(error)
    }
  }

  async function runNow(job: CronJob) {
    const result = await runRoutineNow(profile, job.id)

    if (result === 'busy') {
      toast(`${job.name} is already running`)
    } else if (result) {
      toast(result)
    }
  }

  async function remove(job: CronJob) {
    const error = await removeRoutine(profile, job.id)

    if (error) {
      toast(error)
    }
  }

  function chat(text: string) {
    useDrafts.getState().set(profile, text)

    // Back to the chat when it is below; reached from the dashboard there is none, and the chat opens on top instead.
    if (chatInStack(navigation.getState()?.routes, profile)) {
      router.dismissTo({ pathname: '/bot/[profile]', params: { profile } })
    } else {
      router.push({ pathname: '/bot/[profile]', params: { profile } })
    }
  }

  // Consecutive collapsed routines share one rounded list; an open one is its own card.
  const segments: ({ kind: 'card'; job: CronJob } | { kind: 'list'; jobs: CronJob[] })[] = []

  for (const job of jobs) {
    const open = opened[job.id] ?? jobState(job) === 'failed'
    const last = segments[segments.length - 1]

    if (open) {
      segments.push({ kind: 'card', job })
    } else if (last?.kind === 'list') {
      last.jobs.push(job)
    } else {
      segments.push({ kind: 'list', jobs: [job] })
    }
  }

  const switchFor = (job: CronJob) => <Switch value={pendingOn[job.id] ?? isOn(job)} onValueChange={on => void toggle(job, on)} label={`${job.name} enabled`} />

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Routines" subtitle={name} />

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {!state?.jobs ? (
            <View style={styles.center}>
              {state?.error ? (
                <T variant="secondary" color="text2" style={styles.centered}>
                  {state.error}
                </T>
              ) : (
                <Spinner size={16} />
              )}
            </View>
          ) : jobs.length === 0 ? (
            <View style={styles.center}>
              <T variant="body" style={styles.centered}>
                No routines yet
              </T>
              <T variant="secondary" color="text2" style={styles.centered}>
                A routine is something {name} does on a schedule, like a nightly check.
              </T>
            </View>
          ) : (
            segments.map(segment =>
              segment.kind === 'card' ? (
                <RoutineCard
                  key={segment.job.id}
                  profile={profile}
                  job={segment.job}
                  botName={name}
                  now={now}
                  right={switchFor(segment.job)}
                  onCollapse={() => setOpened(current => ({ ...current, [segment.job.id]: false }))}
                  onRunNow={() => (isOn(segment.job) ? void runNow(segment.job) : setRunningPaused(segment.job))}
                  onAskWhy={() => chat(askWhyDraft(segment.job, now))}
                  onDelete={() => setDeleting(segment.job)}
                />
              ) : (
                <View key={segment.jobs[0]?.id} style={[styles.list, { backgroundColor: c.sheet }]}>
                  {segment.jobs.map((job, index) => (
                    <View key={job.id}>
                      {index > 0 ? <View style={[styles.separator, { backgroundColor: c.separator }]} /> : null}
                      <Pressable accessibilityRole="button" accessibilityLabel={`${job.name}, show details`} onPress={() => setOpened(current => ({ ...current, [job.id]: true }))} style={styles.row}>
                        <View style={styles.rowText}>
                          <T variant="bodySemibold" color={isOn(job) ? 'text' : 'text2'} numberOfLines={1}>
                            {job.name}
                          </T>
                          <T variant="secondary" color="text2" numberOfLines={1}>
                            {routineLine(job, now)}
                          </T>
                        </View>
                        {switchFor(job)}
                      </Pressable>
                    </View>
                  ))}
                </View>
              )
            )
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pill label="New routine" variant="primary" height={52} onPress={() => chat(NEW_ROUTINE_DRAFT)} style={styles.primary} />
          <T variant="meta" color="text2" style={styles.centered}>
            Describe it to {name} and it sets up the schedule.
          </T>
        </View>

        <ConfirmSheet
          visible={!!runningPaused}
          title={`Run ${runningPaused?.name ?? 'this routine'}?`}
          message="It is paused. Running it switches it back on, so it will carry on at its schedule."
          confirmLabel="Run and switch on"
          onClose={() => setRunningPaused(null)}
          onConfirm={() => runningPaused && void runNow(runningPaused)}
        />

        <ConfirmSheet
          visible={!!deleting}
          title={`Delete ${deleting?.name ?? 'this routine'}?`}
          message="It stops running and its schedule is removed. Its past runs stay in the history."
          confirmLabel="Delete routine"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={() => deleting && void remove(deleting)}
        />
      </Screen>
    </BotPaper>
  )
}

interface CardProps {
  profile: string
  job: CronJob
  botName: string
  now: Date
  right: React.ReactNode
  onCollapse: () => void
  onRunNow: () => void
  onAskWhy: () => void
  onDelete: () => void
}

/** One routine opened up: how its last runs went, and Run now / Ask why / Delete. */
function RoutineCard({ profile, job, botName, now, right, onCollapse, onRunNow, onAskWhy, onDelete }: CardProps) {
  const { c } = useTheme()
  const failed = lastRunFailed(job)
  const key = runKey(profile, job.id)
  const runs = useRoutines(store => store.runs[key])
  const running = useRoutines(store => !!store.running[key])

  useEffect(() => {
    void useRoutines.getState().loadRuns(profile, job.id)
  }, [profile, job.id, job.last_run_at])

  return (
    <View style={[styles.card, { backgroundColor: c.sheet }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${job.name}, hide details`} onPress={onCollapse} style={styles.cardHead}>
        <View style={styles.rowText}>
          <T variant="bodySemibold" color={isOn(job) ? 'text' : 'text2'}>
            {job.name}
          </T>
          <T variant="secondary" color="text2">
            {routineLine(job, now)}
          </T>
          {failed ? (
            <T variant="meta" color="danger">
              {failedLine(job, now)}
            </T>
          ) : null}
        </View>
        {right}
      </Pressable>

      <View style={styles.history}>
        {!runs ? (
          <View style={styles.historyLoading}>
            <Spinner size={14} />
          </View>
        ) : runs.length === 0 ? (
          <T variant="secondary" color="text2" style={styles.historyEmpty}>
            Hasn’t run yet
          </T>
        ) : (
          runs.slice(0, 5).map((run, index) => <RunRow key={run.id} run={run} latestFailed={index === 0 && failed} note={index === 0 && failed ? job.last_error || job.last_delivery_error || null : null} now={now} />)
        )}
      </View>

      <View style={styles.actions}>
        <Pill label="Run now" height={40} loading={running} onPress={onRunNow} style={styles.runNow} />
        {failed ? <Pill label={`Ask ${botName} why`} height={40} onPress={onAskWhy} /> : null}
        <Pill label="Delete" variant="danger" height={40} onPress={onDelete} />
      </View>
    </View>
  )
}

function RunRow({ run, latestFailed, note, now }: { run: CronRun; latestFailed: boolean; note: string | null; now: Date }) {
  const { c } = useTheme()
  const outcome = runOutcome(run, latestFailed)
  const started = run.started_at ? new Date(run.started_at * 1000) : null
  const detail = outcome === 'failed' ? note || 'Didn’t finish' : outcome === 'running' ? 'Running…' : run.started_at && run.ended_at ? durationLabel(run.ended_at - run.started_at) : ''
  const tint = outcome === 'failed' ? c.danger : c.text2

  return (
    <View style={styles.run}>
      {outcome === 'running' ? <Spinner size={12} /> : <Feather name={outcome === 'failed' ? 'x' : 'check'} size={14} color={tint} />}
      <T variant="secondary" color={outcome === 'failed' ? 'text' : 'text2'} style={styles.runWhen} numberOfLines={1}>
        {started ? whenLabel(started, now) : '—'}
      </T>
      <T variant="secondary" color="text2" numberOfLines={1} style={styles.runDetail}>
        {detail}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 12, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 80, paddingHorizontal: 24 },
  centered: { textAlign: 'center' },
  list: { borderRadius: radius.group, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  card: { borderRadius: radius.group, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  history: { gap: 2 },
  historyLoading: { minHeight: 32, justifyContent: 'center' },
  historyEmpty: { minHeight: 32, textAlignVertical: 'center' },
  run: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 10 },
  runWhen: { flex: 1 },
  runDetail: { maxWidth: '55%', textAlign: 'right' },
  runNow: { minWidth: 112 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10 },
  primary: { alignSelf: 'stretch' },
})
