import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { TapFace } from '@/components/bots/TapFace'
import { CallControls } from '@/components/call/CallControls'
import { CallRings } from '@/components/call/CallRings'
import { WorkLines } from '@/components/call/WorkLines'
import { PromptCard } from '@/components/chat/PromptCard'
import { IconCircle } from '@/components/ui/IconCircle'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { CallSnapshot } from '@/features/call/engine'
import { callStatus, captionTail } from '@/features/call/view'
import { callWork } from '@/features/call/work'
import { motionFor } from '@/features/face/motion'
import { pendingPrompts } from '@/features/transcript/reduce'
import { clock } from '@/lib/hermes/audio'
import { useNowMs } from '@/lib/useNow'
import { useBotView, useFaceColor } from '@/stores/bots'
import { useCall } from '@/stores/call'
import { useBotSession } from '@/stores/sessions'
import { BotTint } from '@/theme/ThemeProvider'
import { fonts } from '@/theme/tokens'

/** The face, large; smaller while a card waits for you, so the card has room. */
const FACE = 168
const FACE_WAITING = 128

/** Who the rings follow: the voice while its audio plays, you while the server hears you (not while muted). */
function talking(call: CallSnapshot): 'you' | 'voice' | null {
  if (call.phase !== 'live') {
    return null
  }

  return call.speaking === 'voice' ? 'voice' : call.speaking === 'you' && !call.muted ? 'you' : null
}

/**
 * A voice call with a bot, on its own paper: the face large with rings that follow whoever is talking, one live caption, and
 * one quiet line per step of the work the call handed to the bot's chat. An approval or question rises here as the chat's own
 * card, answered by tap only (never by voice). The chevron shows the chat, where the call goes on in a bar.
 */
export default function CallScreen() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const view = useBotView(profile)
  const tint = useFaceColor(profile)
  const call = useCall(state => (state.profile === profile ? state.call : null))
  const since = useCall(state => state.since)
  const level = useCall(state => state.level)
  const voiceLevel = useCall(state => state.voiceLevel)
  const transcript = useBotSession(profile)?.transcript
  const name = view?.name ?? profile
  const live = call?.phase === 'live'
  const now = useNowMs(live)
  const seconds = live && since ? Math.max(0, Math.floor((now - since) / 1000)) : 0

  const prompt = useMemo(() => (transcript ? pendingPrompts(transcript)[0] : undefined), [transcript])
  const work = useMemo(() => (transcript && since ? callWork(transcript.items, since, transcript.running) : null), [transcript, since])

  // Back to the chat, once: the chevron, Hang up, or the call being over.
  const left = useRef(false)
  const leave = useCallback(() => {
    if (left.current) {
      return
    }

    left.current = true

    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace({ pathname: '/bot/[profile]', params: { profile } })
    }
  }, [router, profile])

  // No call with this bot (its ending has been shown, or the screen was opened without one): the chat is where to be.
  useEffect(() => {
    if (!call) {
      leave()
    }
  }, [call, leave])

  if (!call) {
    return (
      <BotTint color={tint}>
        <Screen>{null}</Screen>
      </BotTint>
    )
  }

  const status = callStatus(call, name, !!prompt)
  const who = talking(call)
  const caption = call.caption ? captionTail(call.caption.text) : ''
  const working = call.tasks > 0
  const face = (
    <TapFace name={profile} meta={view?.meta} size={prompt ? FACE_WAITING : FACE} mood={working ? 'work' : 'idle'} motion={motionFor({ needsYou: !!prompt, working })} />
  )
  const captionText = caption ? (
    <T aria-live="polite" color={call.caption?.who === 'you' ? 'text2' : 'text'} numberOfLines={3} style={styles.caption}>
      {caption}
    </T>
  ) : null

  return (
    <BotTint color={tint}>
      <Screen edges={['top']}>
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          <View style={styles.header}>
            <IconCircle icon="chevron-down" label="Show the chat" onPress={leave} />
            <View style={styles.title}>
              <T variant="heading" numberOfLines={1}>
                {name}
              </T>
              <T variant="status" color="text2" style={styles.clock}>
                {live ? clock(seconds) : call.phase === 'connecting' ? 'Voice call' : 'Call ended'}
              </T>
            </View>
            <View style={styles.side} />
          </View>

          <View style={[styles.main, prompt ? styles.mainWaiting : null]}>
            <View style={[styles.stage, prompt ? styles.stageWaiting : null]}>
              {prompt ? (
                face
              ) : (
                <CallRings who={who} level={who === 'voice' ? voiceLevel : level} color={tint} size={FACE}>
                  {face}
                </CallRings>
              )}
              <View style={styles.status}>
                {status.mark === 'spinner' ? <Spinner size={12} /> : status.mark === 'needs' ? <AttentionDot size={8} /> : null}
                <T variant="label" color="text2" numberOfLines={2} style={styles.statusText}>
                  {status.text}
                </T>
              </View>
              {prompt ? captionText : null}
            </View>

            {prompt ? (
              <View style={styles.card}>
                <PromptCard item={prompt} profile={profile} botName={name} riseKey={`call:${prompt.requestId}`} />
              </View>
            ) : (
              <View style={styles.below}>
                {captionText}
                {work ? <WorkLines work={work} /> : null}
              </View>
            )}
          </View>

          <CallControls
            call={call}
            quiet={!!prompt}
            onHangUp={() => {
              useCall.getState().hangUp()
              leave()
            }}
          />
        </KeyboardAvoidingView>
      </Screen>
    </BotTint>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, alignItems: 'center', minWidth: 0 },
  side: { width: 40 },
  clock: { fontVariant: ['tabular-nums'] },
  main: { flex: 1, alignItems: 'center', paddingHorizontal: 28 },
  mainWaiting: { paddingHorizontal: 20, paddingBottom: 12 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 },
  stageWaiting: { gap: 20, paddingHorizontal: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { textAlign: 'center', flexShrink: 1 },
  card: { alignSelf: 'stretch' },
  // Room for three lines of caption and two of work, so the face does not move as they come and go.
  below: { minHeight: 150, alignSelf: 'stretch', alignItems: 'center', gap: 14 },
  caption: { fontFamily: fonts.medium, fontSize: 22, lineHeight: 30, letterSpacing: -0.3, textAlign: 'center', maxWidth: 340 },
})
