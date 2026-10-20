import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { HoursSheet, NumbersSheet, Segmented, StepperSheet, SubRow, TextSheet } from '@/components/phone/SettingsParts'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { addressLabel, formatNumber, hoursLabel, openerProblem, standardOpener } from '@/features/phone/view'
import type { SettingsChange } from '@/lib/hermes/phone'
import { useBotViews } from '@/stores/bots'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

type Editing = 'address' | 'name' | 'opener' | 'tests' | 'dnc' | 'hours' | 'cap' | 'max' | 'hold' | null

const minutes = (n: number) => `${n} min`

/** Shown wherever the opening line is changed: whether a call must say so is the person's to know. */
const OPENER_LAW =
  'The law where you are, and where the people you call are, may require a call to say that the caller is an AI, and that the call is transcribed or recorded. The standard line says both. If you write your own, making sure it meets those laws is up to you.'

/**
 * Settings → Phone: the line and the call service, test or live, and everything that bounds a call (the name it gives,
 * what it never shares, who it never calls, hours and limits, whether it may ask you mid-call) and which bots may call.
 */
export default function PhoneSettings() {
  const router = useRouter()
  const { c } = useTheme()
  const status = usePhone(state => state.status)
  const settings = usePhone(state => state.settings)
  const available = usePhone(state => state.available)
  const views = useBotViews({ includeHidden: true })
  const [editing, setEditing] = useState<Editing>(null)
  const [goLive, setGoLive] = useState(false)
  const [pulling, setPulling] = useState(false)

  useEffect(() => {
    void usePhone.getState().refresh()
    void usePhone.getState().loadSettings()
  }, [])

  async function save(change: SettingsChange) {
    setEditing(null)
    const error = await usePhone.getState().saveSettings(change)

    if (error) {
      toast(error)
    }
  }

  async function pull() {
    setPulling(true)
    await Promise.all([usePhone.getState().refresh(), usePhone.getState().loadSettings()])
    setPulling(false)
  }

  if (!settings || !status) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Phone" />
        <View style={styles.center}>
          {available === false ? (
            <T variant="secondary" color="text2" style={styles.centered}>
              This server doesn’t have the phone plugin.
            </T>
          ) : (
            <Spinner size={16} />
          )}
        </View>
      </Screen>
    )
  }

  const ready = status.line.set && status.service.running
  const live = status.service.live
  const serviceLine = status.service.running ? `Call service running · ${live ? `${live} on the line` : 'no call on the line'}` : 'The call service isn’t running'

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Phone" />
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={c.text2} />}>
        <GroupedList>
          <View style={styles.status} accessible accessibilityLabel={`${status.line.set ? `Line ending ${status.line.number}` : 'No phone line'}. ${serviceLine}`}>
            <View style={[styles.statusIcon, { backgroundColor: c.tone }]}>
              <Feather name="phone" size={18} color={c.text2} />
              <View style={[styles.statusDot, { backgroundColor: ready ? c.connected : c.danger, borderColor: c.sheet }]} />
            </View>
            <View style={styles.flex}>
              <T variant="rowTitle" numberOfLines={1}>
                {status.line.set ? `Line ending ${status.line.number}` : 'No phone line set up'}
              </T>
              <T variant="label" color="text2" numberOfLines={2}>
                {serviceLine}
              </T>
            </View>
          </View>
          <Row label="Public address" value={addressLabel(settings.public_url)} onPress={() => setEditing('address')} />
          <Row
            label="Stage"
            right={
              <Segmented
                label="Stage"
                value={settings.stage}
                options={[
                  { value: 'test', label: 'Test' },
                  { value: 'live', label: 'Live' },
                ]}
                onChange={stage => (stage === 'live' && settings.stage !== 'live' ? setGoLive(true) : stage !== settings.stage && void save({ stage }))}
              />
            }
          />
        </GroupedList>
        <T variant="label" color="text2" style={styles.footnote}>
          Test calls only the numbers below. Live calls the numbers a brief names, after your OK.
        </T>

        <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
          Test numbers
        </T>
        <GroupedList>
          {settings.test_numbers.map(number => (
            <Row key={number} label={formatNumber(number)} right={<IconCircle icon="minus" label={`Remove ${formatNumber(number)}`} bare diameter={32} onPress={() => void save({ test_numbers: settings.test_numbers.filter(other => other !== number) })} />} />
          ))}
          <SubRow label="Add a test number" lead={<Feather name="plus" size={18} color={c.text} />} chevron={false} onPress={() => setEditing('tests')} />
        </GroupedList>

        <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
          On calls
        </T>
        <GroupedList>
          <Row label="Name to use" value={settings.name || 'Not set'} onPress={() => setEditing('name')} />
          {/* hermes-phone 0.1.3+ answers the opening line; an older one doesn't take it. */}
          {settings.opener !== undefined ? <Row label="Opening line" value={settings.opener ? 'Your own' : 'Standard'} onPress={() => setEditing('opener')} /> : null}
          <SubRow label="Never share" sub="Needs your tick on any call" value={String(settings.never_share.length)} onPress={() => router.push('/phone/never-share')} />
          <Row label="Do not call" value={`${settings.do_not_call.length} ${settings.do_not_call.length === 1 ? 'number' : 'numbers'}`} onPress={() => setEditing('dnc')} />
        </GroupedList>
        <T variant="label" color="text2" style={styles.footnote}>
          The name the voice gives{settings.opener !== undefined ? ', and the first thing it says' : ''}. Never-share values stay on your server and only show their last two characters.
          {settings.opener ? ` Your own opening line: ${OPENER_LAW.replace(/^The law/, 'the law')}` : ''}
        </T>

        <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
          Limits
        </T>
        <GroupedList>
          <Row label="Calling hours" value={hoursLabel(settings.hours)} onPress={() => setEditing('hours')} />
          <Row label="Calls a day" value={String(settings.daily_cap)} onPress={() => setEditing('cap')} />
          <Row label="Longest call" value={minutes(settings.max_minutes)} onPress={() => setEditing('max')} />
          <Row label="Longest hold" value={minutes(settings.hold_minutes)} onPress={() => setEditing('hold')} />
        </GroupedList>
        <T variant="label" color="text2" style={styles.footnote}>
          One call at a time. Hours are the server’s local time; the daily cap counts any 24 hours.
        </T>

        <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
          During a call
        </T>
        <GroupedList>
          <SubRow label="Transcripts" sub={settings.opener ? 'Kept 30 days; say so in your opening line' : 'Kept 30 days; the opening line says so'} right={<Switch value={settings.transcripts} label="Transcripts" onValueChange={on => void save({ transcripts: on })} />} />
          <SubRow label="Ask me during a call" sub="Up to 3 questions; a minute to answer" right={<Switch value={settings.ask_owner} label="Ask me during a call" onValueChange={on => void save({ ask_owner: on })} />} />
        </GroupedList>

        <T variant="label" color="text2" style={styles.caption} accessibilityRole="header">
          Bots that may call
        </T>
        <GroupedList>
          {views.map(view => {
            const on = settings.bots.includes(view.profile)

            return (
              <SubRow
                key={view.profile}
                label={view.name}
                lead={<BotFace name={view.profile} meta={view.meta} size={28} />}
                right={<Switch value={on} label={`${view.name} may call`} onValueChange={next => void save({ bots: next ? [...settings.bots, view.profile] : settings.bots.filter(bot => bot !== view.profile) })} />}
              />
            )
          })}
        </GroupedList>
        <T variant="label" color="text2" style={styles.footnote}>
          A bot also needs the phone plugin in its own profile.
        </T>

        <T variant="meta" color="text2" style={styles.version}>
          hermes-phone {status.version}
        </T>
      </ScrollView>

      <TextSheet
        title="Public address"
        note="The https address Twilio reaches the call service at (a Tailscale Funnel, for one)."
        value={settings.public_url}
        placeholder="https://home-server.example.ts.net"
        keyboardType="url"
        visible={editing === 'address'}
        check={text => (text && !/^https:\/\//i.test(text) ? 'It has to start with https://' : null)}
        onClose={() => setEditing(null)}
        onSave={public_url => void save({ public_url })}
      />
      <TextSheet title="Name to use" note="The voice says “calling for” this name. Your first name is enough." value={settings.name} placeholder="Alex" visible={editing === 'name'} onClose={() => setEditing(null)} onSave={name => void save({ name })} />
      <TextSheet
        title="Opening line"
        note="Said word for word, then why it’s calling. {name} is your name. Left empty, a call uses the standard line shown above."
        footnote={OPENER_LAW}
        value={settings.opener ?? ''}
        placeholder={standardOpener(settings.name, settings.transcripts)}
        multiline
        check={openerProblem}
        visible={editing === 'opener'}
        onClose={() => setEditing(null)}
        onSave={opener => void save({ opener })}
      />
      <NumbersSheet title="Test numbers" note="In the test stage, these are the only numbers a call goes to." numbers={settings.test_numbers} visible={editing === 'tests'} onClose={() => setEditing(null)} onSave={test_numbers => void save({ test_numbers })} />
      <NumbersSheet title="Do not call" note="Never dialed. A number that asks not to be called again is added here by itself." numbers={settings.do_not_call} visible={editing === 'dnc'} onClose={() => setEditing(null)} onSave={do_not_call => void save({ do_not_call })} />
      <HoursSheet hours={settings.hours} visible={editing === 'hours'} onClose={() => setEditing(null)} onSave={hours => void save({ hours })} />
      <StepperSheet title="Calls a day" note="Counts any 24 hours, across every bot." value={settings.daily_cap} min={1} max={50} unit={String} visible={editing === 'cap'} onClose={() => setEditing(null)} onSave={daily_cap => void save({ daily_cap })} />
      <StepperSheet title="Longest call" note="The call ends politely when it gets here." value={settings.max_minutes} min={2} max={60} unit={minutes} visible={editing === 'max'} onClose={() => setEditing(null)} onSave={max_minutes => void save({ max_minutes })} />
      <StepperSheet title="Longest hold" note="After this long on hold, the call gives up and says it will call back." value={settings.hold_minutes} min={1} max={45} unit={minutes} visible={editing === 'hold'} onClose={() => setEditing(null)} onSave={hold_minutes => void save({ hold_minutes })} />
      <ConfirmSheet
        visible={goLive}
        title="Call real numbers?"
        message="Live calls the numbers a brief names. Each errand still waits for your OK."
        confirmLabel="Go live"
        onClose={() => setGoLive(false)}
        onConfirm={() => {
          setGoLive(false)
          void save({ stage: 'live' })
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  body: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 28 },
  status: { minHeight: 72, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  statusIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statusDot: { position: 'absolute', right: 1, bottom: 1, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  caption: { marginHorizontal: 4, marginTop: 22, marginBottom: 8 },
  footnote: { marginHorizontal: 4, marginTop: 8 },
  version: { textAlign: 'center', paddingTop: 20 },
})
