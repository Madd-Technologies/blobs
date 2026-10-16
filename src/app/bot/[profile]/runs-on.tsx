import Feather from '@expo/vector-icons/Feather'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { describeError } from '@/features/sessions/store'
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
import { useBotView } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { saveRunsOn, useRunsOn } from '@/stores/profiles'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

type Choice = Exclude<RunsOnKind, 'other'>

interface Draft {
  /** null while a cloud sandbox set on the server is kept. */
  kind: Choice | null
  host: string
  user: string
  port: string
  key: string
}

const isChoice = (value: unknown): value is Choice => value === 'local' || value === 'docker' || value === 'ssh'

/** The form as the bot is now, or as New bot asked for (`kind`). */
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

/**
 * Where a bot's commands and files are: the server itself, a container on it, or another computer over SSH. The bot's
 * chats, memory and model calls stay on the server either way. The SSH key is made on the server (hermes-bot-mobile
 * 0.1.4+), so the phone only ever holds its public line. `then=chat` (from New bot) opens the chat after saving.
 */
export default function RunsOnScreen() {
  const { profile, then, kind: preset } = useLocalSearchParams<{ profile: string; then?: string; kind?: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const config = useConnection(state => state.config)
  const online = useConnection(state => state.status === 'online')
  const name = useBotView(profile)?.name ?? profile
  const current = useRunsOn(state => state.byBot[profile])
  const [draft, setDraft] = useState<Draft | null>(null)
  // The bot's key on the server: undefined while reading, null when the server's plugin cannot make one.
  const [key, setKey] = useState<RunsOnKey | null | undefined>(undefined)
  const [check, setCheck] = useState<{ result: RunsOnCheck; of: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // A bot whose SSH address is in the server's `.env` shows it until the person enters another computer.
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

  // The bot's own key, when it is the one in use (or none is set yet).
  const ownKey = !!key && (!form?.key || form.key === key.path)
  const needsKey = showForm && ownKey && key?.public === null

  // Picking another computer makes the bot's key at once, so the line to copy is there when the form is.
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
  // A check only stands for the target it checked.
  const checkedFor = JSON.stringify([form.kind, form.kind === 'ssh' ? target : null])
  const result = check?.of === checkedFor ? check.result : null
  const canCheck = (showForm || form.kind === 'docker') && key !== null && key !== undefined
  // Nothing to write: the same place, and for SSH the same computer and key (or the server's own setup, untouched).
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

    // Checked first when the server can, so a bot is not moved somewhere it cannot reach without the person knowing.
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

  const field = [styles.field, { backgroundColor: c.sheet, color: c.text }]
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
              <View style={styles.section}>
                <View style={styles.group}>
                  <T variant="label" color="text2">
                    Address
                  </T>
                  <TextInput
                    value={form.host}
                    // A pasted user@host:port fills the other fields at once; typed, it is split when the field is left.
                    onChangeText={host => (host.length - form.host.length > 1 ? splitInto(host) : edit({ host }))}
                    onEndEditing={() => splitInto(form.host)}
                    placeholder="vps-1.example.net"
                    placeholderTextColor={c.text2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    accessibilityLabel="Address"
                    style={[field, styles.mono]}
                  />
                </View>
                <View style={styles.pair}>
                  <View style={[styles.group, styles.fill]}>
                    <T variant="label" color="text2">
                      User
                    </T>
                    <TextInput value={form.user} onChangeText={user => edit({ user })} placeholder="ubuntu" placeholderTextColor={c.text2} autoCapitalize="none" autoCorrect={false} accessibilityLabel="User" style={[field, styles.mono]} />
                  </View>
                  <View style={[styles.group, styles.port]}>
                    <T variant="label" color="text2">
                      Port
                    </T>
                    <TextInput value={form.port} onChangeText={port => edit({ port: port.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={5} accessibilityLabel="Port" style={[field, styles.mono]} />
                  </View>
                </View>

                <KeySection
                  name={name}
                  host={form.host}
                  user={form.user}
                  keyInfo={key}
                  ownKey={ownKey}
                  keyPath={form.key}
                  onKeyPath={path => edit({ key: path })}
                  onUseOwnKey={() => key && edit({ key: key.path })}
                />
              </View>
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
              {/* Hermes keeps a chat's terminal until it has been idle for 5 minutes (TERMINAL_LIFETIME_SECONDS), then builds the new one. */}
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

/** The key the other computer must trust: the bot's own (made on the server), one set on the server, or a path to one. */
function KeySection({
  name,
  host,
  user,
  keyInfo,
  ownKey,
  keyPath,
  onKeyPath,
  onUseOwnKey,
}: {
  name: string
  host: string
  user: string
  keyInfo: RunsOnKey | null | undefined
  ownKey: boolean
  keyPath: string
  onKeyPath: (path: string) => void
  onUseOwnKey: () => void
}) {
  const { c } = useTheme()

  if (keyInfo === undefined) {
    return <Spinner size={14} />
  }

  // The server's plugin cannot make keys: name one that is already there, or leave ssh to its own defaults.
  if (keyInfo === null) {
    return (
      <View style={styles.group}>
        <T variant="label" color="text2">
          Key file on the server
        </T>
        <TextInput
          value={keyPath}
          onChangeText={onKeyPath}
          placeholder="/home/you/.ssh/id_ed25519"
          placeholderTextColor={c.text2}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Key file on the server"
          style={[styles.field, styles.mono, { backgroundColor: c.sheet, color: c.text }]}
        />
        <T variant="label" color="text2">
          Empty uses the server’s own SSH setup. Update HermesBot in Settings → Server plugins to make a key here and check the connection.
        </T>
      </View>
    )
  }

  if (!ownKey) {
    return (
      <View style={styles.group}>
        <T variant="label" color="text2">
          Uses the key at {keyPath} on the server.
        </T>
        <GroupedList radius={20}>
          <Row label={`Make a key for ${name}`} onPress={onUseOwnKey} />
        </GroupedList>
      </View>
    )
  }

  return (
    <View style={styles.group}>
      <T variant="label" color="text2">
        Add this key on {host.trim() || 'that computer'}
      </T>
      {keyInfo.public ? (
        <>
          <View style={[styles.key, { backgroundColor: c.sheet }]}>
            <T variant="monoSmall" color="text2" numberOfLines={3} selectable style={styles.keyText}>
              {keyInfo.public}
            </T>
            <Pill
              label="Copy"
              icon="copy"
              height={36}
              accessibilityLabel="Copy the key"
              onPress={() => {
                void Clipboard.setStringAsync(keyInfo.public ?? '')
                toast('Key copied')
              }}
            />
          </View>
          <T variant="label" color="text2">
            As a new line in ~/.ssh/authorized_keys for {user.trim() || 'that user'}. The private key stays on your server.
          </T>
        </>
      ) : (
        <View style={styles.making}>
          <Spinner size={14} />
          <T variant="label" color="text2">
            Making a key for {name}…
          </T>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 14 },
  note: { paddingHorizontal: 8 },
  section: { gap: 14 },
  group: { gap: 6 },
  pair: { flexDirection: 'row', gap: 10 },
  port: { width: 96 },
  field: { borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  mono: { fontFamily: fonts.mono, fontSize: 15 },
  key: { borderRadius: radius.field, paddingLeft: 14, paddingRight: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  keyText: { flex: 1 },
  making: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  buttons: { flexDirection: 'row', gap: 10, paddingTop: 4 },
})
