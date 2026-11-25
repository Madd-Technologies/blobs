import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { RunsOnSshForm } from '@/components/bots/RunsOnSshForm'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { describeError } from '@/lib/hermes/errors'
import {
  checkLine,
  checkRunsOn,
  detailOf,
  makeRunsOnKey,
  RUNS_ON_CHOICES,
  runsOnChange,
  runsOnKey,
  runsOnLabel,
  splitAddress,
  targetProblem,
  type RunsOn,
  type RunsOnCheck,
  type RunsOnKey,
  type RunsOnKind,
  type SshTarget,
} from '@/lib/hermes/runsOn'
import { useBotIdentity } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { saveRunsOn, useRunsOn } from '@/stores/profiles'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'

type Choice = Exclude<RunsOnKind, 'other'>

interface Draft {
  kind: Choice | null
  host: string
  user: string
  port: string
  key: string
}

const isChoice = (value: unknown): value is Choice => value === 'local' || value === 'docker' || value === 'ssh'

function draftOf(current: RunsOn, preset: unknown): Draft {
  return {
    kind: isChoice(preset) ? preset : current.kind === 'other' ? null : current.kind,
    host: current.host,
    user: current.user,
    port: String(current.port),
    key: current.key,
  }
}

const errorText = (error: unknown) => detailOf(error) ?? describeError(error)

export default function RunsOnScreen() {
  const { profile, then, kind: preset } = useLocalSearchParams<{ profile: string; then?: string; kind?: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const config = useConnection(state => state.config)
  const online = useConnection(state => state.status === 'online')
  const name = useBotIdentity(profile)?.name ?? profile
  const current = useRunsOn(state => state.byBot[profile])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [key, setKey] = useState<RunsOnKey | null | undefined>(undefined)
  const [check, setCheck] = useState<{ result: RunsOnCheck; of: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)

  const form = draft ?? (current ? draftOf(current, preset) : null)
  const serverSet = current?.kind === 'ssh' && current.fromServer && !entering
  const showForm = form?.kind === 'ssh' && !serverSet
  const edit = (patch: Partial<Draft>) => {
    if (form) {
      setDraft({ ...form, ...patch })
      setProblem(null)
    }
  }

  useEffect(() => {
    if (online) {
      void useRunsOn.getState().load(profile)
    }
  }, [online, profile])

  useEffect(() => {
    if (!config || !online) {
      return
    }

    let live = true
    runsOnKey(config, profile).then(
      found => live && setKey(found),
      () => live && setKey(null),
    )

    return () => {
      live = false
    }
  }, [config, online, profile])

  const ownKey = !!key && (!form?.key || form.key === key.path)
  const needsKey = showForm && ownKey && key?.public === null

  useEffect(() => {
    if (!needsKey || !config) {
      return
    }

    let live = true
    makeRunsOnKey(config, profile).then(
      made => live && setKey(made),
      error => live && setProblem(errorText(error)),
    )

    return () => {
      live = false
    }
  }, [needsKey, config, profile])

  if (!current || !form) {
    return (
      <BotPaper profile={profile}>
        <Screen edges={['top', 'bottom']}>
          <ScreenHeader title="Runs on" subtitle={name} />
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        </Screen>
      </BotPaper>
    )
  }

  const target: SshTarget = { host: form.host, user: form.user, port: Number(form.port), key: ownKey && key?.public ? key.path : form.key }
  const checkedFor = JSON.stringify([form.kind, form.kind === 'ssh' ? target : null])
  const result = check?.of === checkedFor ? check.result : null
  const canCheck = (showForm || form.kind === 'docker') && key !== null && key !== undefined
  const unchanged =
    form.kind === current.kind &&
    (form.kind !== 'ssh' || !showForm || (form.host.trim() === current.host && form.user.trim() === current.user && Number(form.port) === current.port && target.key === current.key))

  async function runCheck(): Promise<RunsOnCheck | null> {
    if (!config || !form || (form.kind !== 'ssh' && form.kind !== 'docker')) {
      return null
    }

    const wrong = form.kind === 'ssh' ? targetProblem(target) : null

    if (wrong) {
      setProblem(wrong)

      return null
    }

    setProblem(null)
    setChecking(true)

    try {
      const found = await checkRunsOn(config, profile, form.kind, form.kind === 'ssh' ? target : undefined)
      setCheck({ result: found, of: checkedFor })

      return found
    } catch (error) {
      setProblem(errorText(error))

      return null
    } finally {
      setChecking(false)
    }
  }

  function leave() {
    if (then === 'chat') {
      router.replace({ pathname: '/bot/[profile]', params: { profile } })
    } else if (router.canGoBack()) {
      router.back()
    }
  }

  async function save(anyway: boolean) {
    if (!current || !form?.kind) {
      return
    }

    if (unchanged) {
      leave()

      return
    }

    const wrong = form.kind === 'ssh' ? targetProblem(target) : null

    if (wrong) {
      setProblem(wrong)

      return
    }

    if (canCheck && !anyway && !result?.ok && !(await runCheck())?.ok) {
      return
    }

    setSaving(true)
    const error = await saveRunsOn(profile, runsOnChange(current, form.kind, form.kind === 'ssh' ? target : undefined))
    setSaving(false)

    if (error) {
      toast(error)

      return
    }

    toast(form.kind === 'ssh' ? `${name} runs on ${target.host.trim()} now` : form.kind === 'docker' ? `${name} runs in a container now` : `${name} runs on this computer now`)
    leave()
  }

  function splitInto(address: string) {
    const parts = splitAddress(address)
    edit({ host: parts.host, ...(parts.user ? { user: parts.user } : {}), ...(parts.port ? { port: String(parts.port) } : {}) })
  }

  const failed = result !== null && !result.ok

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Runs on" subtitle={name} />
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <T variant="label" color="text2" style={styles.note}>
              Where {name}’s commands and files are. Its chats, memory and model stay on your server.
            </T>

            <GroupedList radius={20}>
              {current.kind === 'other' ? (
                <Row label={runsOnLabel(current)} value={form.kind ? undefined : 'Set on the server'} right={form.kind ? undefined : <Feather name="check" size={18} color={c.text} />} chevron={false} />
              ) : null}
              {RUNS_ON_CHOICES.map(choice => (
                <Row
                  key={choice.kind}
                  label={choice.label}
                  right={form.kind === choice.kind ? <Feather name="check" size={18} color={c.text} accessibilityLabel="Selected" /> : undefined}
                  chevron={false}
                  onPress={() => edit({ kind: choice.kind })}
                />
              ))}
            </GroupedList>

            {form.kind === 'ssh' && serverSet ? (
              <View style={styles.group}>
                <T variant="label" color="text2" style={styles.note}>
                  Set up on the server{current.serverTarget ? ` for ${current.serverTarget}` : ''}, with its own key and port.
                </T>
                <GroupedList radius={20}>
                  <Row
                    label="Enter another computer"
                    onPress={() => {
                      const [user, host] = current.serverTarget?.split('@') ?? []
                      setEntering(true)
                      edit({ host: host ?? '', user: user ?? '' })
                    }}
                  />
                </GroupedList>
              </View>
            ) : null}

            {showForm ? (
              <RunsOnSshForm
                name={name}
                host={form.host}
                user={form.user}
                port={form.port}
                keyPath={form.key}
                keyInfo={key}
                ownKey={ownKey}
                onHost={host => edit({ host })}
                onUser={user => edit({ user })}
                onPort={port => edit({ port })}
                onSplitAddress={splitInto}
                onKeyPath={key => edit({ key })}
                onUseOwnKey={() => key && edit({ key: key.path })}
              />
            ) : null}

            {problem || result ? (
              <T variant="secondary" color={problem || failed ? 'danger' : 'text'} style={styles.note} selectable>
                {problem ?? (result ? checkLine(result, target) : '')}
              </T>
            ) : null}

            <View style={styles.buttons}>
              {canCheck ? <Pill label="Check" flex height={48} loading={checking} disabled={saving} onPress={() => void runCheck()} /> : null}
              <Pill label={failed ? 'Save anyway' : 'Save'} variant="primary" flex height={48} loading={saving} disabled={!form.kind || checking} onPress={() => void save(failed)} />
            </View>

            <T variant="label" color="text2" style={styles.note}>
              {`New chats move at once; a chat in use moves after 5 quiet minutes.${
                form.kind === 'ssh'
                  ? ` The server copies ${name}’s skills and sign-in files to ~/.hermes on that computer.`
                  : form.kind === 'docker'
                    ? ' The container runs on the server with Docker; files made there stay inside it.'
                    : ''
              }`}
            </T>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 14 },
  note: { paddingHorizontal: 8 },
  group: { gap: 6 },
  buttons: { flexDirection: 'row', gap: 10, paddingTop: 4 },
})
