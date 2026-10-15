import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BotPaper } from '@/components/bots/BotPaper'
import { KeysBar } from '@/components/screen/KeysBar'
import { ScreenView } from '@/components/screen/ScreenView'
import { useScreenViewer } from '@/components/screen/useScreenViewer'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { chord, eventsForChange, KEY, type Modifier } from '@/features/display/keys'
import { isMine } from '@/features/display/store'
import { wording } from '@/features/transcript/activity'
import type { Step } from '@/features/transcript/types'
import { useKeyboardHeight } from '@/lib/useKeyboardHeight'
import { useConnection } from '@/stores/connection'
import { useBotView } from '@/stores/bots'
import { display, useScreen } from '@/stores/display'
import { sessions, useBotSession } from '@/stores/sessions'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** "9:52" from a wall-clock ms stamp. */
function clock(ms: number): string {
  const date = new Date(ms)

  return `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The last few things the bot did, newest first, from its chat. */
function recentSteps(items: { kind: string; steps?: Step[] }[] | undefined, count = 4): Step[] {
  const steps = (items ?? []).flatMap(item => (item.kind === 'activity' ? (item.steps ?? []) : []))

  return steps.slice(-count).reverse()
}

export default function ScreenWatch() {
  const { c } = useTheme()
  const router = useRouter()
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const view = useBotView(profile)
  // The sheet under the picture runs to the bottom edge; its content stays clear of the home indicator.
  const insets = useSafeAreaInsets()
  const screen = useScreen(profile)
  const session = useBotSession(profile)
  const baseUrl = useConnection(state => state.config?.baseUrl ?? '')
  const online = useConnection(state => state.status === 'online')
  const [options, setOptions] = useState(false)
  const [sudo, setSudo] = useState('')

  const status = screen?.status
  const running = !!status?.running
  const mine = isMine(status?.lease, screen?.viewer ?? null)
  const humanElsewhere = status?.lease.holder === 'human' && !mine
  const name = view?.name ?? profile

  const { attach, onEvent, phase, notice, error, send, paste, setFit } = useScreenViewer(profile, { active: true, running, driving: mine })
  const keyboardHeight = useKeyboardHeight()
  const keyboard = useRef<TextInput>(null)
  const [fit, setFitState] = useState(true)
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  /**
   * The hidden typing field only exists to catch keystrokes. It is NOT controlled: a controlled field on iOS can
   * have its text overwritten by a stale value while typing fast, which would read as backspaces. The native
   * field keeps its own text, `lastTyping` is what it held, and bumping `typingKey` remounts it empty.
   */
  const [typingKey, setTypingKey] = useState(0)
  const lastTyping = useRef('')

  // Read the screen when it opens (once connected), and keep the bot's chat live for its activity.
  useEffect(() => {
    if (online) {
      void display.refresh(profile)
      void sessions.open(profile)
    }
  }, [online, profile])

  const ratio = useMemo(() => {
    const [w, h] = (status?.geometry ?? '1440x900').split('x').map(Number)

    return w && h ? w / h : 1.6
  }, [status?.geometry])

  const needsYou = view?.attention.state === 'needsYou'
  const steps = recentSteps(session?.transcript.items)

  const subtitle = !status ? '' : !running ? 'Off' : mine ? 'You have control' : humanElsewhere ? 'Someone has control' : needsYou ? 'Waiting for you' : 'Watching'

  async function takeOver() {
    await display.takeOver(profile, status?.lease.reason || undefined).catch(() => undefined)
  }

  async function handBack() {
    // The bot only waits on a hand-back when it asked for one (it left a reason on the lease, or is waiting on
    // you). A take-over to peek or tinker should not put words in the chat.
    const botAsked = needsYou || !!status?.lease.reason
    const released = await display.handBack(profile).then(
      () => true,
      () => false,
    )

    if (released && botAsked) {
      void sessions.send(profile, "I'm done, continue.")
    }
  }

  // ── what stands in for the picture when there is none ─────────────────────────────────────────────
  let cover: React.ReactNode = null

  if (screen?.support === 'no') {
    cover = <Notice title="Bot screens aren’t available" body="This Hermes server does not have Bot Screen. It needs a newer Hermes on a Linux host." />
  } else if (!status) {
    cover = screen?.error ? <Notice title="Couldn’t read the screen" body={screen.error} /> : <Spinner size={20} />
  } else if (!status.supported) {
    cover = <Notice title="This host can’t run bot screens" body="Bot Screen runs on Linux hosts only." />
  } else if (!status.installed) {
    cover = (
      <View style={styles.coverBody}>
        <T variant="heading">Set up bot screens</T>
        <T variant="secondary" color="text2" style={styles.centered}>
          The host is missing a few desktop packages ({status.missing.length}). Installing them takes about a minute.
        </T>
        {screen?.busy === 'installing' ? (
          <>
            <Spinner size={16} />
            <T variant="meta" color="text2" numberOfLines={2} style={[styles.centered, { fontFamily: fonts.mono }]}>
              {screen.installLog.at(-1) ?? 'Starting…'}
            </T>
          </>
        ) : (
          <Pill label="Install on host" variant="primary" onPress={() => void display.install(profile)} />
        )}
        {screen?.needsSudo ? (
          <View style={styles.sudo}>
            <T variant="meta" color="text2" style={styles.centered}>
              The host needs its sudo password to install. It is sent to the host and not kept.
            </T>
            <TextInput
              value={sudo}
              onChangeText={setSudo}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Sudo password"
              placeholderTextColor={c.text2}
              textContentType="oneTimeCode"
              accessibilityLabel="Sudo password"
              style={[styles.field, { backgroundColor: c.tone, color: c.text }]}
            />
            <View style={styles.row}>
              <Pill label="Skip" variant="ghost" onPress={() => display.answerSudo(profile, '')} />
              <Pill
                label="Continue"
                variant="primary"
                disabled={!sudo}
                onPress={() => {
                  display.answerSudo(profile, sudo)
                  setSudo('')
                }}
              />
            </View>
          </View>
        ) : null}
      </View>
    )
  } else if (!running) {
    cover = (
      <View style={styles.coverBody}>
        {screen?.busy === 'starting' ? (
          <Spinner size={20} />
        ) : (
          <Pill label="Start screen" variant="secondary" icon="play" disabled={!!status.blocker} onPress={() => void display.start(profile)} />
        )}
        {status.blocker ? (
          <T variant="meta" color="text2" style={styles.centered}>
            {status.blocker}
          </T>
        ) : null}
      </View>
    )
  } else if (phase === 'connecting' || phase === 'reconnecting') {
    cover = <Spinner size={20} />
  } else if (phase === 'gone' || phase === 'failed') {
    cover = <Notice title={phase === 'gone' ? 'This screen stopped' : 'Couldn’t show the screen'} body={error ?? ''} />
  }

  // ── driving it ───────────────────────────────────────────────────────────────────────────────────
  // Driving stays in portrait, like watching: the picture keeps the top, the phone's own keyboard comes up from
  // the bottom on request, and the extra keys a phone keyboard lacks ride just above it.
  const controlMode = mine && running

  /** Empties the hidden typing field (a new line was started, or it grew). */
  function resetTyping() {
    lastTyping.current = ''
    setTypingKey(key => key + 1)
  }

  /** Sends one key with whatever modifiers are held, which then let go. */
  function pressKey(keysym: number) {
    send(chord(modifiers, keysym))
    setModifiers([])

    if (keysym === KEY.Return) {
      resetTyping()
    }
  }

  function toggleModifier(modifier: Modifier) {
    setModifiers(held => (held.includes(modifier) ? held.filter(entry => entry !== modifier) : [...held, modifier]))
  }

  async function pasteFromClipboard() {
    const text = await Clipboard.getStringAsync()

    if (text) {
      paste(text)
      send(chord(['ctrl'], 0x76))
    }
  }

  function toggleFit() {
    setFit(!fit)
    setFitState(!fit)
  }

  function toggleKeyboard() {
    if (keyboardHeight) {
      Keyboard.dismiss()
    } else {
      // Android keeps the field focused when the keyboard is dismissed with the back gesture, and focusing a field
      // that is already focused does not bring the keyboard back; letting go of it first does.
      keyboard.current?.blur()
      keyboard.current?.focus()
    }
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top']}>
        <View key="header" style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/screens'))} />
          <View style={styles.title}>
            <T variant="heading" numberOfLines={1}>
              {name}
            </T>
            {subtitle ? (
              <T variant="status" color="text2">
                {subtitle}
              </T>
            ) : null}
          </View>
          <IconCircle icon="more-horizontal" label="Screen options" diameter={40} onPress={() => setOptions(true)} disabled={!running} />
        </View>

        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          {/* The picture. It is the same element whether watching or driving, so the connection to the screen
              survives the switch: closing it would hand control back. */}
          <View key="picture" style={[styles.picture, { width: '100%', aspectRatio: ratio }]} accessibilityLabel={`${name}'s screen`}>
            <ScreenView ref={attach} baseUrl={baseUrl} onEvent={onEvent} style={cover ? styles.hidden : undefined} />
            {cover ? <View style={styles.cover}>{cover}</View> : null}
            {controlMode ? <View pointerEvents="none" style={[styles.frame, { borderColor: c.needsYou }]} /> : null}
          </View>

          {/* Under the picture, a sheet of the bot's paper: who has the screen, what the bot did on it, and how to drive it. */}
        <ScrollView key="below" style={[styles.flex, styles.sheet, { backgroundColor: c.sheet }]} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {notice ? (
              <T variant="label" color="text2" style={styles.pad}>
                {notice}
              </T>
            ) : null}
            {screen?.error && status ? (
              <T variant="secondary" color="danger" style={styles.pad}>
                {screen.error}
              </T>
            ) : null}

            {running ? (
              <View style={styles.bar}>
                <View style={[styles.dot, { backgroundColor: controlMode || needsYou ? c.needsYou : c.text2 }]} />
                <T variant="body" style={styles.barText} numberOfLines={2}>
                  {controlMode ? 'You have control.' : humanElsewhere ? 'Someone else is driving this screen.' : needsYou ? `${name} needs you.` : `${name} is working.`}
                </T>
                {controlMode ? (
                  <>
                    <IconCircle icon="type" label={keyboardHeight ? 'Hide keyboard' : 'Show keyboard'} diameter={40} onPress={toggleKeyboard} style={{ backgroundColor: c.canvas }} />
                    <Pill label="Hand back" variant="primary" height={40} onPress={() => void handBack()} />
                  </>
                ) : (
                  // Pressed into the sheet (the canvas) unless the bot needs you, when taking over is the next thing to do.
                <Pill label="Take over" variant={needsYou ? 'primary' : 'secondary'} height={40} onPress={() => void takeOver()} style={needsYou ? undefined : { backgroundColor: c.canvas }} />
                )}
              </View>
            ) : null}

            {steps.length ? (
              <View style={styles.activity} accessibilityLabel="Activity">
                {steps.map((step, index) => (
                  <View key={step.toolId} style={styles.step}>
                    <View style={styles.stepDot}>
                      <View style={index === 0 && step.state === 'running' ? [styles.dotLive, { backgroundColor: c.text }] : [styles.dotQuiet, { backgroundColor: c.track }]} />
                    </View>
                    <T variant="secondary" color={index === 0 ? 'text' : 'text2'} numberOfLines={1} style={styles.flex}>
                      {step.state === 'running' ? wording(step).present : wording(step).past}
                    </T>
                    {step.startedAt ? (
                      <T variant="meta" color="text2">
                        {clock(step.startedAt)}
                      </T>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            <T variant="label" color="text2" style={styles.foot}>
              {controlMode
                ? 'Tap to click · hold to right-click · two fingers to scroll'
                : running
                  ? `Watching won’t interrupt ${name}. Take over to drive it.`
                  : 'Each bot has its own desktop on your server. Idle screens stop on their own.'}
            </T>
          </ScrollView>

          {controlMode && keyboardHeight > 0 ? <KeysBar modifiers={modifiers} onToggleModifier={toggleModifier} onKey={pressKey} /> : null}
        </KeyboardAvoidingView>

        {controlMode ? (
          // Takes what is typed on the phone's keyboard and sends it as keys. The field keeps its text, so each
          // change is read against the last (see `eventsForChange`); it is emptied after Enter and when it grows.
          <TextInput
            key={`typing-${typingKey}`}
            ref={keyboard}
            // After a remount the new field takes over if the keyboard was up, so it stays up.
            autoFocus={typingKey > 0 && keyboardHeight > 0}
            defaultValue=""
            onChangeText={next => {
              const { events, typedAny } = eventsForChange(lastTyping.current, next, modifiers)

              if (events.length) {
                send(events)
              }

              if (typedAny) {
                setModifiers([])
              }

              lastTyping.current = next

              // Enter arrives as a newline in the text (the field is multiline, so the keyboard offers a real
              // Enter instead of "Done"); it was just sent as Return, so start the field over.
              if (next.includes('\n') || next.length > 64) {
                resetTyping()
              }
            }}
            onKeyPress={event => {
              if (event.nativeEvent.key === 'Backspace' && lastTyping.current === '') {
                // Nothing left in the field to delete, so no text change will report it.
                pressKey(KEY.Backspace)
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            multiline
            keyboardType="visible-password"
            textContentType="none"
            accessibilityLabel="Type to the screen"
            style={styles.typing}
          />
        ) : null}

        <Sheet visible={options} onClose={() => setOptions(false)} label="Screen options">
          <GroupedList>
            {controlMode ? (
              <>
                <Row
                  label="Paste from clipboard"
                  chevron={false}
                  onPress={() => {
                    setOptions(false)
                    void pasteFromClipboard()
                  }}
                />
                <Row
                  label={fit ? 'Zoom to actual size' : 'Fit the whole screen'}
                  chevron={false}
                  onPress={() => {
                    setOptions(false)
                    toggleFit()
                  }}
                />
              </>
            ) : null}
            {humanElsewhere ? (
              <Row
                label={`Give control back to ${name}`}
                chevron={false}
                onPress={() => {
                  setOptions(false)
                  // Whoever held it (maybe a phone that died mid-drive) is let go, so the bot can carry on.
                  void display.handBack(profile, true).catch(() => undefined)
                }}
              />
            ) : null}
            <Row
              label="Stop screen"
              destructive
              chevron={false}
              onPress={() => {
                setOptions(false)
                void display.stop(profile, humanElsewhere)
              }}
            />
          </GroupedList>
        </Sheet>
      </Screen>
    </BotPaper>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.coverBody}>
      <T variant="heading">{title}</T>
      {body ? (
        <T variant="secondary" color="text2" style={styles.centered}>
          {body}
        </T>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, minWidth: 0 },
  scroll: { paddingBottom: 24 },
  picture: { backgroundColor: '#2B2E34', overflow: 'hidden' },
  hidden: { opacity: 0 },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 20 },
  coverBody: { alignItems: 'center', gap: 10 },
  centered: { textAlign: 'center' },
  sudo: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
  field: { height: 44, borderRadius: radius.field, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15 },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  pad: { paddingHorizontal: 20, paddingTop: 14 },
  sheet: { marginTop: 12, borderTopLeftRadius: radius.tray, borderTopRightRadius: radius.tray },
  bar: { paddingVertical: 8, paddingLeft: 20, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  barText: { flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  activity: { paddingHorizontal: 20, paddingTop: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  stepDot: { width: 8, alignItems: 'center' },
  dotLive: { width: 6, height: 6, borderRadius: 3 },
  dotQuiet: { width: 5, height: 5, borderRadius: 2.5 },
  foot: { textAlign: 'center', paddingHorizontal: 20, paddingTop: 20 },
  flex: { flex: 1 },
  frame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1.5 },
  typing: { position: 'absolute', width: 1, height: 1, opacity: 0, left: 0, bottom: 0 },
})
