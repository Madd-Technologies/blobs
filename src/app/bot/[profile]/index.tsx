import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'

import { TapFace } from '@/components/bots/TapFace'
import { CallBar } from '@/components/call/CallBar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatRow } from '@/components/chat/ChatRow'
import { CallTrayRow, ErrandBlock } from '@/components/phone/ErrandBlock'
import { Composer } from '@/components/chat/Composer'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { callingErrand, errandsForChat, placeErrands, type Placed } from '@/features/phone/view'
import type { BotView } from '@/features/roster/view'
import type { BotSession } from '@/features/sessions/store'
import { pendingPrompts } from '@/features/transcript/reduce'
import { buildDisplay, type DisplayItem } from '@/features/transcript/display'
import { botLastActive } from '@/features/attention/derive'
import { runningLine } from '@/features/transcript/display'
import { jobsLine, runningJobs } from '@/features/transcript/jobs'
import { ageLabel } from '@/features/roster/derive'
import type { PendingFile } from '@/lib/hermes/attachments'
import type { Errand } from '@/lib/hermes/phone'
import { classify, helpGroups, helpText, type SlashAction } from '@/lib/hermes/slash'
import { canCall } from '@/lib/duplexAudio'
import { useNow, useNowMs } from '@/lib/useNow'
import { useStickToLatest } from '@/lib/useStickToLatest'
import { useViewableRows } from '@/lib/useViewableRows'
import { useBotView, useFaceColor } from '@/stores/bots'
import { useCall } from '@/stores/call'
import { useCommands } from '@/stores/commands'
import { useConnection } from '@/stores/connection'
import { useSpeech } from '@/stores/speech'
import { useDrafts } from '@/stores/drafts'
import { useOpenChat } from '@/stores/inbox'
import { usePhone } from '@/stores/phone'
import { usePrefs } from '@/stores/prefs'
import { useSeen } from '@/stores/seen'
import { useOnScreen } from '@/stores/presence'
import { sessions, useBotSession, useChosenChat } from '@/stores/sessions'
import { toast } from '@/stores/toast'
import { useVoice } from '@/stores/voice'
import { BotTint } from '@/theme/ThemeProvider'

/**
 * The quiet line under the bot's name. Once the chat is open its own transcript is the truth about
 * what the bot is doing; the polled status (which lags by seconds) only fills in before that.
 */
function statusLine(view: BotView | undefined, session: BotSession | undefined, nowS: number, jobNowMs: number): string {
  const transcript = session?.phase === 'ready' ? session.transcript : undefined

  if (transcript) {
    if (pendingPrompts(transcript).length) {
      return 'Waiting for you'
    }

    if (transcript.running) {
      // Its helpers' results woke the bot: it is reading what they did, not starting something new.
      return transcript.wake ? 'Reading the result…' : runningLine(transcript.phase, transcript.statusLine)
    }

    // Work the bot left running after its turn (helpers from Hermes 0.21.5, commands from 0.22): it says so here until it is over.
    const working = jobsLine(transcript.jobs, jobNowMs)

    if (working) {
      return working
    }
  } else if (view?.attention.state === 'needsYou') {
    return 'Waiting for you'
  } else if (view?.attention.state === 'working') {
    return 'Working…'
  }

  // The polled roster lags: when this chat has seen something newer, that is the last activity.
  const lastMessageS = Math.max(0, ...(transcript?.items ?? []).map(item => ((item.kind === 'user' || item.kind === 'assistant' || item.kind === 'teammate') && !item.chatter && item.ts ? item.ts / 1000 : 0)))
  const age = ageLabel(Math.max(view ? botLastActive(view.row) : 0, lastMessageS), nowS)

  return view?.row.description || (age ? `Active ${age === 'now' ? 'just now' : `${age} ago`}` : '')
}

/** Says when this is not the bot's main chat, so a side chat is never mistaken for it. */
function chatStatus(line: string, elsewhere: boolean, itemCount: number): string {
  if (!elsewhere) {
    return line
  }

  return itemCount === 0 ? 'New side chat' : `Side chat · ${line}`
}

export default function BotChat() {
  // `chat`: the stored id of the chat a link is about (a notification's), main or side.
  const { profile, chat } = useLocalSearchParams<{ profile: string; chat?: string }>()
  const router = useRouter()
  const openedByLink = useRef(!!chat)
  const view = useBotView(profile)
  const session = useBotSession(profile)
  const chosen = useChosenChat(profile)
  const draft = useDrafts(state => state.byBot[profile])
  const commands = useCommands(state => state.byBot[profile])
  const showThinking = usePrefs(state => state.showThinking)
  const showChatter = usePrefs(state => state.showBotChatter)
  const nowS = useNow(60)
  const setOpen = useOpenChat(state => state.setOpen)
  const markSeen = useSeen(state => state.markSeen)

  // Open the chat, and tell the rest of the app this bot's chat is the one on screen. Leaving the bot returns it to its main
  // chat, which is what Home previews and what opens next time, unless the person chose to come back to the last side chat.
  useEffect(() => {
    // A link opens its own chat (below) instead of the bot's usual one, so nothing else flashes up first.
    if (!openedByLink.current) {
      void sessions.open(profile)
    }

    setOpen(profile)

    return () => {
      setOpen(null)

      if (!usePrefs.getState().reopenLast[profile]) {
        sessions.leaveSide(profile)
      }

      useDrafts.getState().clear(profile)
    }
  }, [profile, setOpen])

  // The chat a link names, also when one arrives while this bot is already on screen. The parameter is cleared after, so the
  // same notification works again once you have moved to another chat.
  useEffect(() => {
    if (chat) {
      openedByLink.current = false
      void sessions.openLinked(profile, chat)
      router.setParams({ chat: undefined })
    }
  }, [profile, chat, router])

  const transcript = session?.transcript
  const itemCount = transcript?.items.length ?? 0
  // Background commands and helpers still going: the header's clock moves, and the server's lists are read again now and then,
  // which catches a job that ends without news (one started without asking to be told).
  const jobsRunning = runningJobs(transcript?.jobs).length > 0
  const jobNowMs = useNowMs(jobsRunning, 15_000)

  useEffect(() => {
    if (!jobsRunning) {
      return
    }

    const timer = setInterval(() => void sessions.refreshJobs(profile), 20_000)

    return () => clearInterval(timer)
  }, [jobsRunning, profile])

  // The `/` picker lists this bot's skills, which only the server knows; ask once the chat is live (and again if it is re-attached).
  const liveId = session?.liveId

  useEffect(() => {
    if (liveId) {
      void useCommands.getState().load(profile)
    }
  }, [profile, liveId])

  // While this chat is open, the server pushes nothing about it to this phone.
  useOnScreen([liveId, session?.storedId].flatMap(id => (id ? [id] : [])))

  // Whatever is in the open chat has been seen. Depends on primitives only: marking a chat seen changes
  // the bot's view, and depending on the view itself would loop.
  const lastActive = view ? botLastActive(view.row) : 0

  useEffect(() => {
    markSeen(profile, Math.max(lastActive, Date.now() / 1000))
  }, [profile, itemCount, lastActive, markSeen])

  // Leaving the chat: everything up to now was seen, so nothing in it shows as unread afterwards.
  useEffect(() => () => markSeen(profile, Date.now() / 1000), [profile, markSeen])

  const list = useRef<FlatList<ChatEntry>>(null)
  // Only what is on screen loads its pictures.
  const viewable = useViewableRows(`chat:${profile}`)
  // On the newest message while you are there (a streaming reply stays in view); let go the moment you scroll.
  const stick = useStickToLatest(list)
  const [away, setAway] = useState(false)
  const stickScroll = stick.onScroll

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      stickScroll(event)
      setAway(event.nativeEvent.contentOffset.y > 400)
    },
    [stickScroll],
  )

  const jumpToLatest = () => stick.toLatest()

  // Files waiting to go with the next message.
  const [files, setFiles] = useState<PendingFile[]>([])

  // Sending takes you to the bottom, where your message and the reply will appear, wherever you had
  // scrolled to (in an inverted list the bottom is offset 0). If it does not go (a file the server refused, a dropped
  // connection) your words and files come back, and the reason is in the chat.
  async function send(text: string) {
    const action = classify(text, commands?.options ?? [], commands?.catalog)

    // A slash command is not a message to the bot: the app answers it with a screen, or the server runs it. Its words come
    // back to the box if it did not run, and the server may hand back words to edit (/undo).
    if (action.kind === 'local') {
      if (action.local === 'new') {
        const error = await sessions.newChat(profile)

        if (error) {
          toast(error)
        }
      } else if (action.local === 'help' && commands) {
        jumpToLatest()

        if (action.arg) {
          sessions.showOutput(profile, text.trim(), helpText(commands.catalog, action.arg))
        } else {
          const { groups, footer } = helpGroups(commands.catalog)

          sessions.showOutput(profile, text.trim(), footer, groups)
        }
      } else if (action.local === 'chats') {
        router.push({ pathname: '/bot/[profile]/chats', params: { profile } })
      } else if (router.canGoBack()) {
        router.back()
      } else {
        router.replace('/')
      }

      return
    }

    if (action.kind === 'run') {
      if (files.length) {
        toast('Files can’t go with a command. Send them in a message.')
        useDrafts.getState().set(profile, text.trim())

        return
      }

      // Hermes finds a bot's main chat by its title, so renaming it can make Hermes start a fresh one: ask first.
      if (action.name === 'title' && !chosen && action.arg) {
        setAsk({ text: text.trim(), action })

        return
      }

      await runSlash(action, text.trim())

      return
    }

    useSpeech.getState().stop()

    const sending = files
    setFiles([])
    jumpToLatest()

    if (!(await sessions.send(profile, text, sending))) {
      setFiles(sending)

      if (text.trim()) {
        useDrafts.getState().set(profile, text.trim())
      }
    }
  }

  async function runSlash(action: Extract<SlashAction, { kind: 'run' }>, text: string) {
    jumpToLatest()
    const outcome = await sessions.runCommand(profile, action.name, action.arg, action.run, text)

    if (!outcome.ok) {
      useDrafts.getState().set(profile, text)
    } else if (outcome.prefill) {
      useDrafts.getState().set(profile, outcome.prefill)
    }
  }

  // A command waiting on "are you sure?". The sheet reports closing before it reports confirming, so the words are given back
  // to the box after a tick, unless the confirming came.
  const [ask, setAsk] = useState<{ text: string; action: Extract<SlashAction, { kind: 'run' }> } | null>(null)
  const confirmed = useRef(false)

  // Sending a message, or leaving the chat, stops any reading aloud.
  useEffect(() => () => useSpeech.getState().stop(), [])

  // Retry under the latest reply: the server's /retry drops that reply and sends your message again. One stable function for every row
  // (rows only draw again when what they show changes); it reads the bot's command list when tapped.
  const toLatest = stick.toLatest
  const retry = useCallback(() => {
    const listed = useCommands.getState().byBot[profile]
    const action = classify('/retry', listed?.options ?? [], listed?.catalog)
    const run = action.kind === 'run' ? action : ({ kind: 'run', name: 'retry', arg: '', run: 'dispatch', known: true } as const)

    useSpeech.getState().stop()
    toLatest()
    void sessions.runCommand(profile, run.name, run.arg, run.run, '/retry')
  }, [profile, toLatest])

  // Phone errands the bot made in this chat, each at the end of the turn it was made in.
  const allErrands = usePhone(state => state.errands)
  const canonical = view?.row.canonical_session
  const errands = useMemo(
    () => errandsForChat(Object.values(allErrands), profile, chosen ? [session?.storedId, chosen] : [session?.storedId, canonical?.id, canonical?.resolved_id], !chosen),
    [allErrands, profile, chosen, session?.storedId, canonical?.id, canonical?.resolved_id],
  )
  const calling = callingErrand(errands)

  // Newest first, for the inverted list.
  const data = useMemo<ChatEntry[]>(
    () => placeErrands(buildDisplay(transcript?.items ?? [], { now: nowS * 1000, showThinking, showChatter, chatterFrom: transcript?.chatterFrom, running: transcript?.running }), errands, turnStart).reverse(),
    [transcript?.items, transcript?.chatterFrom, transcript?.running, nowS, showThinking, showChatter, errands],
  )
  const newestRow = data.findIndex(entry => entry.kind !== 'errand')

  const name = view?.name ?? profile
  // The chat is on the bot's own paper.
  const tint = useFaceColor(profile)

  // Voice calls (the hermes-voice plugin): for a bot that takes them, the mic becomes Call. A call has its own screen over the
  // chat; behind it, the chat's bar holds the call.
  const online = useConnection(state => state.status === 'online')
  const voice = useVoice(state => state.byBot[profile]?.voice)
  const callHere = useCall(state => (state.profile === profile ? state.call : null))
  const description = view?.meta?.description

  useEffect(() => {
    if (online) {
      void useVoice.getState().load(profile)
    }
  }, [online, profile])

  // A call belongs to its chat: leaving the chat hangs up.
  useEffect(
    () => () => {
      if (useCall.getState().profile === profile) {
        useCall.getState().hangUp()
      }
    },
    [profile],
  )

  const startCall = useCallback(() => {
    const current = useCall.getState().call

    if (current && current.phase !== 'ended') {
      toast('You’re already on a call.')

      return
    }

    if (!voice?.ready) {
      toast(voice?.account === 'key' ? `${name} has no xAI key yet: add one, or use the Grok sign-in.` : 'This server has no Grok sign-in: choose the bot’s own key.')
      router.push({ pathname: '/bot/[profile]/voice', params: { profile } })

      return
    }

    useSpeech.getState().stop()
    useCall.getState().start(profile, { name, about: description })
    router.push({ pathname: '/bot/[profile]/call', params: { profile } })
  }, [voice, name, description, profile, router])
  const openCall = useCallback(() => router.push({ pathname: '/bot/[profile]/call', params: { profile } }), [router, profile])
  const callable = canCall() && !!voice?.enabled
  const waiting = transcript ? pendingPrompts(transcript).length > 0 : view?.attention.state === 'needsYou'
  // During a call the header says so, unless the chat has something more pressing to say.
  const onCall = !!callHere && callHere.phase !== 'ended' && !waiting && !transcript?.running
  const opening = !session || session.phase === 'idle' || (session.phase === 'opening' && itemCount === 0)
  const failed = session?.phase === 'error' && itemCount === 0

  return (
    <BotTint color={tint}>
      <Screen edges={['top']}>
        <ChatHeader
          profile={profile}
          view={view}
          status={chatStatus(onCall ? 'On a call' : statusLine(view, session, nowS, jobsRunning ? jobNowMs : nowS * 1000), !!chosen, itemCount)}
          waiting={waiting}
          working={!!transcript?.running}
        />

        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          {opening ? (
            <View style={styles.center}>
              <Spinner size={18} />
            </View>
          ) : failed ? (
            <View style={styles.center}>
              <T variant="secondary" color="text2" style={styles.centered}>
                {session?.error ?? 'Could not open this chat.'}
              </T>
              <Pill label="Try again" variant="secondary" onPress={() => void sessions.open(profile)} />
            </View>
          ) : data.length === 0 ? (
            <View style={styles.center}>
              <TapFace name={profile} meta={view?.meta} size={72} />
              <T variant="heading">{name}</T>
              {view?.row.description ? (
                <T variant="secondary" color="text2" style={styles.centered}>
                  {view.row.description}
                </T>
              ) : null}
            </View>
          ) : (
            <View style={styles.fill}>
              <FlatList
                ref={list}
                inverted
                data={data}
                keyExtractor={entry => (entry.kind === 'item' ? entry.item.id : entry.id)}
                renderItem={({ item, index }) =>
                  item.kind === 'errand' ? <ErrandBlock errand={item.errand} botName={name} meta={view?.meta} /> : <ChatRow entry={item} list={`chat:${profile}`} profile={profile} botName={name} latest={index === newestRow} onRetry={retry} />
                }
                {...viewable}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                onEndReachedThreshold={0.5}
                onEndReached={() => void sessions.loadOlder(profile)}
                ListFooterComponent={session?.loadingOlder ? <Spinner size={14} /> : null}
                onScroll={onScroll}
                onScrollBeginDrag={stick.onScrollBeginDrag}
                onScrollEndDrag={stick.onScrollEndDrag}
                onMomentumScrollBegin={stick.onMomentumScrollBegin}
                onMomentumScrollEnd={stick.onMomentumScrollEnd}
                scrollEventThrottle={32}
                onContentSizeChange={stick.onContentSizeChange}
                // Holds your place while you read older messages, and follows new ones while you're at the newest: the list does both in
                // the same layout pass. Pinning alone pushed a new message just below the screen whenever the pin landed after the
                // jump to the newest row (often, on Android), so it looked like nothing arrived.
                maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 80 }}
              />
              {away ? (
                <View style={styles.jump}>
                  <IconCircle icon="chevron-down" label="Jump to latest" diameter={40} onPress={jumpToLatest} />
                </View>
              ) : null}
            </View>
          )}

          {callHere ? (
            <CallBar profile={profile} botName={name} meta={view?.meta} call={callHere} waiting={!!transcript && pendingPrompts(transcript).length > 0} onOpen={openCall} />
          ) : (
            <Composer key={draft?.nonce ?? 0} botName={name} running={!!transcript?.running} initialText={draft?.text} files={files} onFilesChange={setFiles} voiceProfile={profile} onCall={callable ? startCall : undefined} commands={commands?.options} above={calling ? <CallTrayRow errand={calling} /> : undefined} onSend={text => void send(text)} onStop={() => void sessions.stop(profile)} />
          )}
        </KeyboardAvoidingView>

        <ConfirmSheet
          visible={!!ask}
          title={`Rename ${name}’s main chat?`}
          message="Hermes finds a bot’s main chat by its title. Renaming it can make Hermes start a fresh main chat and leave this one behind."
          confirmLabel="Rename it"
          onConfirm={() => {
            confirmed.current = true

            if (ask) {
              void runSlash(ask.action, ask.text)
            }
          }}
          onClose={() => {
            const waiting = ask

            setAsk(null)
            setTimeout(() => {
              if (waiting && !confirmed.current) {
                useDrafts.getState().set(profile, waiting.text)
              }

              confirmed.current = false
            }, 0)
          }}
        />
      </Screen>
    </BotTint>
  )
}

/** A row of the chat: the transcript's own, or a phone errand placed among them. */
type ChatEntry = DisplayItem | Placed<Errand>

/** Where a turn starts, for placing errands: your message, something that woke the bot, or a day's date line. */
function turnStart(entry: DisplayItem): { ts?: number } | null {
  if (entry.kind === 'date') {
    return {}
  }

  const { item } = entry

  return item.kind === 'user' || item.kind === 'note' || item.kind === 'teammate' ? { ts: item.ts } : null
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Floats over the bottom-right of the list, so it clears the composer however tall that is.
  jump: { position: 'absolute', right: 16, bottom: 12 },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
})
