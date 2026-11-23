import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { KeyboardAvoidingView, Pressable, RefreshControl, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { DefaultRecord } from '@/components/dashboard/DefaultRecord'
import { FieldSheet } from '@/components/dashboard/FieldSheet'
import { LaidOutRecord } from '@/components/dashboard/LaidOutRecord'
import { approvalDraftOf, useApprovals } from '@/components/dashboard/useApprovals'
import { useRowActions } from '@/components/dashboard/useRowActions'
import { IconCircle } from '@/components/ui/IconCircle'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { SkeletonRecord } from '@/components/ui/Skeleton'
import { T } from '@/components/ui/T'
import { askAboutRecord, nextStage, recordHeading } from '@/features/dashboard/view'
import { haptic } from '@/lib/haptics'
import type { Field } from '@/lib/hermes/dashboard'
import { useNow } from '@/lib/useNow'
import { useBotDirectory, useBotIdentity } from '@/stores/bots'
import { useDashboards } from '@/stores/dashboards'
import { useDrafts } from '@/stores/drafts'
import { toast } from '@/stores/ui'
import { useWatch } from '@/stores/watch'
import { useTheme } from '@/theme/ThemeProvider'

export default function DashboardRecord() {
  const { profile, id } = useLocalSearchParams<{ profile: string; id: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const detail = useDashboards(state => state.records[id])
  const bots = useBotDirectory()
  const owner = useBotIdentity(detail?.record.created_by ?? profile)
  const [error, setError] = useState<string | null>(null)
  const [pulling, setPulling] = useState(false)
  const [editing, setEditing] = useState<Field | null>(null)
  const [busy, setBusy] = useState<'next' | 'close' | 'note' | 'press' | null>(null)
  const [more, setMore] = useState(false)

  const botName = (who: string) => bots[who]?.name ?? who
  const name = botName(profile)
  const clock = useNow(60)
  const rows = useRowActions(detail?.now ?? clock, botName)
  const approvals = useApprovals(detail)
  const nameOf = (who: string) => bots[who]?.name ?? null

  useFocusEffect(
    useCallback(() => {
      void useDashboards
        .getState()
        .loadRecord(id)
        .then(problem => setError(problem))
    }, [id]),
  )

  useWatch('dashboards', [profile])
  useWatch('records', [id])
  const pushed = useDashboards(state => state.pushed[profile])

  useEffect(() => {
    if (pushed) {
      void useDashboards.getState().loadRecord(id)
    }
  }, [pushed, id])

  async function onPull() {
    setPulling(true)
    setError(await useDashboards.getState().loadRecord(id))
    setPulling(false)
  }

  async function run(kind: 'next' | 'close' | 'note' | 'press', call: () => Promise<string | null>) {
    setBusy(kind)
    const problem = await call()
    setBusy(null)

    if (problem) {
      toast(problem)
    }

    return problem
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/bot/[profile]/dashboard', params: { profile } }))

  if (!detail) {
    return (
      <BotPaper profile={profile}>
        <Screen edges={['top', 'bottom']}>
          <View style={styles.header}>
            <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={back} />
            <View style={styles.flex} />
            <View style={styles.spacer} />
          </View>
          {error ? (
            <View style={styles.center}>
              <T variant="secondary" color="text2" style={styles.centered}>
                {error}
              </T>
            </View>
          ) : (
            <SkeletonRecord />
          )}
        </Screen>
      </BotPaper>
    )
  }

  const { record, collection } = detail
  const nowS = detail.now
  const heading = recordHeading(detail)
  const status = collection.fields.find(field => field.type === 'status' && !field.retired)
  const next = record.closed_at ? null : nextStage(status, status ? record.values[status.key] : undefined)
  const nextCloses = !!next && !!status?.stages?.find(stage => stage.name === next)?.done
  const buttons = detail.show?.actions ?? []
  const running = detail.show?.running ?? null
  const mutedUntil = record.muted_until && record.muted_until > nowS ? record.muted_until : null

  const change = (field: Field, value: unknown) => useDashboards.getState().change(profile, id, { [field.key]: value })

  const askBot = (prompt = askAboutRecord(heading.title, collection.title, record.id)) => {
    useDrafts.getState().set(profile, prompt)
    router.push({ pathname: '/bot/[profile]', params: { profile } })
  }

  async function press(action: { id: string; label: string }) {
    setMore(false)

    const draft = approvalDraftOf(detail!, action.id)

    if (draft) {
      return approve(action, draft)
    }

    if (!(await run('press', () => useDashboards.getState().press(profile, id, action.id)))) {
      router.push({ pathname: '/bot/[profile]', params: { profile } })
    }
  }

  async function approve(action: { id: string; label: string }, draft: string) {
    if (approvals.changed[draft]) {
      approvals.reviewed(draft)

      return
    }

    const digest = approvals.drawn[draft]
    const state = approvals.states[draft]

    if (!digest || !state || (state.kind !== 'waiting' && state.kind !== 'stale')) {
      toast('This draft can’t be approved right now. Pull down to load it again.')

      return
    }

    setBusy('press')
    const result = await useDashboards.getState().approve(profile, id, action.id, digest)
    setBusy(null)

    if (result && typeof result === 'object') {
      haptic('reject')
      approvals.markChanged(draft, digest, result.changed)
    } else if (result) {
      toast(result)
    } else {
      haptic('confirm')
      router.push({ pathname: '/bot/[profile]', params: { profile } })
    }
  }

  const openJob = () => {
    if (running?.session) {
      router.push({ pathname: '/bot/[profile]', params: { profile, chat: running.session } })
    }
  }

  const refreshControl = <RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={back} />
          <T variant="heading" numberOfLines={1} style={styles.flex} accessibilityRole="header">
            {collection.title}
          </T>
          <View style={styles.headerRight}>
            {!running && buttons.length > 2 ? <IconCircle icon="more-horizontal" label="More buttons" onPress={() => setMore(true)} /> : null}
            {record.closed_at ? (
              <View style={styles.spacer} />
            ) : (
              <IconCircle
                icon={mutedUntil ? 'bell' : 'bell-off'}
                label={mutedUntil ? 'Unmute' : 'Mute'}
                onPress={() => rows.mute(profile, { id: record.id, title: { key: 'title', type: 'text', value: heading.title }, muted_until: mutedUntil ?? undefined })}
              />
            )}
          </View>
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {collection.layout ? (
            <LaidOutRecord
              detail={detail}
              nowS={nowS}
              nameOf={nameOf}
              ownerMeta={owner?.meta}
              approvals={approvals}
              busy={busy}
              refreshControl={refreshControl}
              next={next}
              onEdit={setEditing}
              onToggle={(field, value) => void change(field, value).then(problem => problem && toast(problem))}
              onChange={change}
              onNote={text => run('note', () => useDashboards.getState().note(profile, id, text))}
              onPress={action => void press(action)}
              onApprove={(action, draft) => void approve(action, draft)}
              onAsk={() => askBot()}
              onOpenJob={openJob}
              onSetClosed={() => void run('close', () => useDashboards.getState().setClosed(profile, id, !record.closed_at))}
              onNext={stage => status && void run('next', () => change(status, stage))}
            />
          ) : (
            <DefaultRecord
              detail={detail}
              nowS={nowS}
              botName={botName}
              profileName={name}
              ownerMeta={owner?.meta}
              approvals={approvals}
              busy={busy}
              next={next}
              nextCloses={nextCloses}
              refreshControl={refreshControl}
              onEdit={setEditing}
              onToggle={(field, value) => void change(field, value).then(problem => problem && toast(problem))}
              onNote={async text => !(await run('note', () => useDashboards.getState().note(profile, id, text)))}
              onPress={action => void press(action)}
              onApprove={(action, draft) => void approve(action, draft)}
              onAsk={prompt => askBot(prompt)}
              onOpenJob={openJob}
              onSetClosed={() => void run('close', () => useDashboards.getState().setClosed(profile, id, !record.closed_at))}
              onNext={(statusField, stage) => void run('next', () => change(statusField, stage))}
            />
          )}
        </KeyboardAvoidingView>

        <FieldSheet
          field={editing}
          value={editing ? record.values[editing.key] : null}
          subtitle={editing?.to && record.values[editing.to] ? `To ${String(record.values[editing.to])}` : undefined}
          nowS={nowS}
          botName={botName(record.created_by)}
          onClose={() => setEditing(null)}
          onSave={value => (editing ? change(editing, value) : Promise.resolve(null))}
        />

        {rows.sheet}

        <Sheet visible={more} onClose={() => setMore(false)} label="More buttons">
          <View style={styles.sheet}>
            {buttons.slice(2).map((action, index) => (
              <View key={action.id}>
                {index > 0 ? <View style={[styles.sheetRule, { backgroundColor: c.separator }]} /> : null}
                <Pressable accessibilityRole="button" onPress={() => void press(action)} style={({ pressed }) => [styles.sheetRow, pressed && { backgroundColor: c.pressedIn }]}>
                  <T variant="body">{action.label}</T>
                </Pressable>
              </View>
            ))}
            <T variant="label" color="text2" style={styles.sheetNote}>
              Each opens a side chat with {name} to do it.
            </T>
          </View>
        </Sheet>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 6 },
  spacer: { width: 40 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  sheet: { paddingBottom: 8 },
  sheetRow: { minHeight: 52, paddingHorizontal: 4, justifyContent: 'center', borderRadius: 8 },
  sheetRule: { height: 1, marginLeft: 4 },
  sheetNote: { marginHorizontal: 4, marginTop: 10 },
})
