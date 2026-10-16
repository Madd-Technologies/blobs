import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Linking, ScrollView, StyleSheet, View } from 'react-native'

import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { installMessage } from '@/features/plugins/catalog'
import type { PushLevel } from '@/lib/hermes/push-api'
import { useBotViews } from '@/stores/bots'
import { useNow } from '@/lib/useNow'
import { push, usePush } from '@/stores/push'
import { toast } from '@/stores/toast'

const NTFY_URL = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy'

const LEVELS: { value: PushLevel; label: string; hint: string }[] = [
  { value: 'all', label: 'Everything', hint: 'Approvals, questions, failed routines, and the start of each reply.' },
  { value: 'needs_you', label: 'Needs you', hint: 'Only approvals, questions and routines that fail.' },
  { value: 'off', label: 'Off', hint: 'Nothing from this bot.' },
]

const levelLabel = (level: PushLevel) => LEVELS.find(option => option.value === level)?.label ?? level

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
function since(thenS: number, nowS: number): string {
  const diff = Math.max(0, nowS - thenS)

  if (diff < 60) {
    return 'just now'
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)} min ago`
  }

  return diff < 86_400 ? `${Math.floor(diff / 3600)} h ago` : `${Math.floor(diff / 86_400)} d ago`
}

/** Which bot (or "everyone else") the level sheet is changing. */
type Target = { profile: string | null; name: string }

export default function Notifications() {
  const phase = usePush(state => state.phase)

  useEffect(() => {
    void push.refresh()
  }, [])

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {phase.kind === 'on' ? (
          <On />
        ) : (
          <Setup />
        )}
      </ScrollView>
    </Screen>
  )
}

/** Everything before notifications are on: one message, one next step. */
function Setup() {
  const phase = usePush(state => state.phase)

  switch (phase.kind) {
    case 'loading':
    case 'working':
      return (
        <View style={styles.center}>
          <Spinner size={16} />
          {phase.kind === 'working' ? (
            <T variant="secondary" color="text2">
              {phase.what}…
            </T>
          ) : null}
        </View>
      )

    case 'unsupported':
      return <Message title="Not on this device yet" body="Notifications work on Android builds of HermesBot. iPhone support comes later." />

    case 'no-plugin':
      return (
        <Message
          title="Your server can’t send notifications yet"
          body="It needs the HermesBot plugin (hermes-bot-mobile). Copy the setup message and paste it to your Hermes bot; when it’s done, restart Hermes and check again."
        >
          <Pill
            label="Copy setup message"
            icon="copy"
            variant="primary"
            onPress={() => {
              void Clipboard.setStringAsync(installMessage(['hermes-bot-mobile']))
              toast('Copied. Paste it to your Hermes bot, then restart Hermes when it’s done.')
            }}
          />
          <Pill label="Check again" onPress={() => void push.refresh()} />
        </Message>
      )

    case 'no-distributor':
      return (
        <Message title="Install a push app" body="Notifications arrive through an app like ntfy on your phone, not through Google. Install one, then come back.">
          <Pill label="Get ntfy" variant="primary" onPress={() => void Linking.openURL(NTFY_URL)} />
          <Pill label="I installed it" onPress={() => void push.enable()} />
        </Message>
      )

    case 'choose-distributor':
      return (
        <View style={styles.stack}>
          <T variant="secondary" color="text2" style={styles.lead}>
            Which app should deliver them?
          </T>
          <GroupedList>
            {phase.options.map(option => (
              <Row key={option.id} label={option.name ?? option.id} onPress={() => void push.enable(option.id)} />
            ))}
          </GroupedList>
        </View>
      )

    case 'blocked':
      return (
        <Message title="Notifications are blocked" body="Allow notifications for HermesBot in Android’s settings, then try again.">
          <Pill label="Open settings" variant="primary" onPress={() => void Linking.openSettings()} />
          <Pill label="Try again" onPress={() => void push.enable()} />
        </Message>
      )

    case 'error':
      return (
        <Message title="That didn’t work" body={phase.message}>
          <Pill label="Try again" variant="primary" onPress={() => void push.enable()} />
        </Message>
      )

    default:
      return (
        <Message title="Know when a bot needs you" body="Get a notification when a bot is waiting on an approval or has a question, even when the app is closed.">
          <Pill label="Turn on notifications" variant="primary" height={52} onPress={() => void push.enable()} />
        </Message>
      )
  }
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <View style={styles.message}>
      <T variant="heading" style={styles.centered}>
        {title}
      </T>
      <T variant="secondary" color="text2" style={styles.centered}>
        {body}
      </T>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  )
}

function On() {
  const devices = usePush(state => state.devices)
  const mine = usePush(state => state.mine)
  const settings = usePush(state => state.settings)
  const test = usePush(state => state.test)
  const views = useBotViews({ includeHidden: true })
  const [target, setTarget] = useState<Target | null>(null)
  const device = devices.find(row => row.id === mine)
  const nowS = useNow()

  const lastPush = device?.last_error ? 'Last push failed' : device?.last_ok ? `Delivered ${since(device.last_ok, nowS)}` : 'Nothing sent yet'

  const current = (profile: string | null): PushLevel => (profile ? (settings.bots[profile] ?? settings.default) : settings.default)

  return (
    <View style={styles.stack}>
      <GroupedList>
        <Row label="This phone" value={device?.name || 'Android'} chevron={false} />
        <Row label="Delivery" value={lastPush} chevron={false} />
        <Row label="Send a test" onPress={() => void push.sendTest()} />
      </GroupedList>
      {test ? (
        <T variant="label" color={test.ok ? 'text2' : 'danger'} style={styles.note}>
          {test.message}
        </T>
      ) : null}

      <T variant="meta" color="text2" style={styles.section}>
        How much each bot may tell you
      </T>
      <GroupedList>
        <Row label="Everyone else" value={levelLabel(settings.default)} onPress={() => setTarget({ profile: null, name: 'Everyone else' })} />
        {views.map(view => (
          <Row key={view.profile} label={view.name} value={levelLabel(current(view.profile))} onPress={() => setTarget({ profile: view.profile, name: view.name })} />
        ))}
      </GroupedList>

      <GroupedList>
        <Row label="Turn off notifications" destructive onPress={() => void push.disable()} />
      </GroupedList>

      <Sheet visible={target !== null} onClose={() => setTarget(null)} label={target ? `${target.name} notifications` : 'Notifications'}>
        <GroupedList>
          {LEVELS.map(option => (
            <Row
              key={option.value}
              label={option.label}
              value={target && current(target.profile) === option.value ? 'Selected' : undefined}
              chevron={false}
              onPress={() => {
                if (target) {
                  void (target.profile ? push.setLevel(target.profile, option.value) : push.setDefault(option.value))
                }

                setTarget(null)
              }}
            />
          ))}
        </GroupedList>
        <T variant="label" color="text2" style={styles.hints}>
          {LEVELS.map(option => `${option.label}: ${option.hint}`).join('\n')}
        </T>
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  stack: { gap: 16 },
  center: { alignItems: 'center', gap: 12, paddingTop: 80 },
  message: { alignItems: 'center', gap: 8, paddingTop: 72, paddingHorizontal: 12 },
  centered: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 10, paddingTop: 20 },
  lead: { textAlign: 'center', paddingTop: 4 },
  note: { paddingHorizontal: 4, marginTop: -8 },
  section: { paddingHorizontal: 4, paddingTop: 8, marginBottom: -8 },
  hints: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
})
