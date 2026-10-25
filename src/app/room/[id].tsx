import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, StyleSheet, View } from 'react-native'

import { Composer } from '@/components/chat/Composer'
import { StampReveal } from '@/components/chat/Gestures'
import { ReplyStrip } from '@/components/chat/ReplyStrip'
import { MentionChips } from '@/components/rooms/MentionChips'
import { RoomActions } from '@/components/rooms/RoomActions'
import { RoomFaces } from '@/components/rooms/RoomFaces'
import { RoomMessage } from '@/components/rooms/RoomMessage'
import { TypingRow } from '@/components/rooms/TypingRow'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { afterSheetCloses } from '@/lib/afterSheet'
import { activityPhrase, answerPausedText, askedOnly, roomAttention, buildTimeline, memberName, memberOf, nameList, pausedAsk, pausedLine, replyingLine, type TimelineItem } from '@/lib/hermes/rooms'
import { withReply } from '@/features/transcript/reply'
import { lastDoneBy, liveWords, showLiveTurn } from '@/lib/hermes/livepush'
import { useNow } from '@/lib/useNow'
import { useStickToLatest } from '@/lib/useStickToLatest'
import { useBotMetas } from '@/stores/bots'
import { removeRoom, sendToRoom, startRoomPoll, stopRoomWork, useRoomData, useRooms } from '@/stores/rooms'
import { useOnScreen } from '@/stores/presence'
import { toast } from '@/stores/toast'
import { useWatch } from '@/stores/watch'

/** A group room: you and several bots in one conversation, run by the server so it carries on with the app closed. */
export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const data = useRoomData(id)
  const metas = useBotMetas()
  const nowS = useNow(60)
  const [text, setText] = useState('')
  // The message you swiped to reply to (shown above the field until you send).
  const [replyTo, setReplyTo] = useState<{ who: string; text: string; memberId?: string } | null>(null)
  const [focusComposer, setFocusComposer] = useState(0)
  const reply = useCallback((target: { who: string; text: string; memberId?: string }) => {
    setReplyTo(target)
    setFocusComposer(count => count + 1)
  }, [])
  const [options, setOptions] = useState(false)
  const [confirmDisband, setConfirmDisband] = useState(false)

  // Only while the room is on top (a room left under another screen stops reading its log).
  useFocusEffect(useCallback(() => startRoomPoll(id), [id]))
  // The server then streams this room's turns and pushes its changes.
  useWatch('rooms', [id])
  // While the room is open, the server pushes nothing about it to this phone.
  useOnScreen(data?.sessions ?? [])

  const room = data?.room
  const working = data?.status?.working === true
  const replying = data?.replying ?? []
  // The members' turns as they stream (hermes-bot-mobile 0.2+), until the log has each one's reply or the end of its turn.
  const live = useRooms(state => state.live[id])
  const liveTurns = useMemo(() => {
    if (!live || !data) {
      return []
    }

    const done = lastDoneBy(data.events)

    return Object.entries(live.members).filter(([memberId, turn]) => showLiveTurn(turn, done[memberId], nowS))
  }, [live, data, nowS])
  const streaming = new Set(liveTurns.map(([memberId]) => memberId))
  const attention = useMemo(() => (room && data ? roomAttention(room, data.events, data.status) : null), [room, data])
  // The server cut the bots off with a question still open: the room stays quiet until you write again.
  const paused = useMemo(() => (room && data && !working ? pausedAsk(room, data.events) : null), [room, data, working])
  // Newest first, for the inverted list.
  const items = useMemo<TimelineItem[]>(() => (room && data ? buildTimeline(room, data.events).reverse() : []), [room, data])
  const handles = useMemo(() => room?.members.map(member => member.handle) ?? [], [room])

  // On the newest message while you are there (new replies stay in view); let go the moment you scroll.
  const list = useRef<FlatList<TimelineItem>>(null)
  const stick = useStickToLatest(list)

  const mention = useCallback((handle: string) => setText(current => `${current}${current && !/\s$/.test(current) ? ' ' : ''}@${handle} `), [])

  /** What is sent for `message`: a reply quotes the message it answers, and mentions the member who wrote it so that one answers. */
  const outgoing = useCallback(
    (message: string) => {
      const handle = replyTo?.memberId && room ? memberOf(room, replyTo.memberId)?.handle : undefined
      const addressed = handle && !new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(message) ? `@${handle} ${message}` : message

      return replyTo ? withReply(replyTo.text, addressed) : message
    },
    [replyTo, room],
  )
  // Hermes asks only the members a message @mentions (everyone when it mentions none), so say so while you write.
  const asked = useMemo(() => (room ? askedOnly(room, outgoing(text)) : []), [room, outgoing, text])
  const askedHint = room && asked.length ? `Only ${nameList(asked.map(memberId => memberName(room, memberId)))} ${asked.length > 1 ? 'are' : 'is'} asked` : null

  function send(message: string) {
    // Sending takes you to the bottom, where your message and the replies will appear.
    stick.toLatest()
    setText('')
    const sent = outgoing(message)
    setReplyTo(null)
    void sendToRoom(id, sent).then(error => error && toast(error))
  }

  async function stop() {
    setOptions(false)
    const error = await stopRoomWork(id)

    if (error) {
      toast(error)
    }
  }

  async function disband() {
    const error = await removeRoom(id)

    if (error) {
      toast(error)

      return
    }

    router.dismissTo('/')
  }

  if (!room || !data) {
    return (
      <Screen edges={['top']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
        <View style={styles.center}>
          <Spinner size={16} />
        </View>
      </Screen>
    )
  }

  const subtitle = working ? replyingLine(room, replying, data.activity) : nameList(room.members.map(member => member.display_name || member.handle))

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <RoomFaces members={room.members} metas={metas} variant="header" />
        <View style={styles.title}>
          <T variant="heading" numberOfLines={1}>
            {room.name}
          </T>
          <T variant="status" color="text2" numberOfLines={1}>
            {subtitle}
          </T>
        </View>
        <IconCircle icon="more-horizontal" label="Room options" onPress={() => setOptions(true)} />
      </View>

      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        {items.length === 0 && !attention?.actions.length ? (
          <View style={styles.center}>
            <T variant="heading">{room.name}</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              Say something to {nameList(room.members.map(member => member.display_name || member.handle))}. Everyone answers, or only the bots you @mention.
            </T>
          </View>
        ) : (
          <View style={styles.fill}>
            <StampReveal>
              <FlatList
                ref={list}
                inverted
                data={items}
                keyExtractor={item => item.id}
                renderItem={({ item }) => <RoomMessage item={item} handles={handles} metas={metas} now={nowS * 1000} onReply={reply} />}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                onScroll={stick.onScroll}
                scrollEventThrottle={32}
                onScrollBeginDrag={stick.onScrollBeginDrag}
                onScrollEndDrag={stick.onScrollEndDrag}
                onMomentumScrollBegin={stick.onMomentumScrollBegin}
                onMomentumScrollEnd={stick.onMomentumScrollEnd}
                onContentSizeChange={stick.onContentSizeChange}
                // Sits at the bottom of the inverted list: what the room is holding for you, or that bots are replying.
                ListHeaderComponent={
                  attention?.actions.length || data.questions?.length || working || paused || liveTurns.length ? (
                    <View style={styles.footer}>
                      {attention?.actions.length || data.questions?.length ? <RoomActions room={room} actions={attention?.actions ?? []} questions={data.questions} framed /> : null}
                      {liveTurns.map(([memberId, turn]) => {
                        const profile = memberOf(room, memberId)?.profile ?? memberId

                        return (
                          <TypingRow
                            key={memberId}
                            name={memberName(room, memberId)}
                            profile={profile}
                            meta={metas[profile]}
                            doing={activityPhrase({ phase: turn.phase, tool: turn.tool, since: turn.started })}
                            text={liveWords(turn)}
                            steps={turn.steps}
                            cut={turn.cut}
                          />
                        )
                      })}
                      {working && replying.length
                        ? replying.filter(memberId => !streaming.has(memberId)).map(memberId => {
                            const profile = memberOf(room, memberId)?.profile ?? memberId
                            const activity = data.activity?.[memberId]

                            return (
                              <TypingRow
                                key={memberId}
                                name={memberName(room, memberId)}
                                profile={profile}
                                meta={metas[profile]}
                                doing={activity ? activityPhrase(activity) : null}
                                minutes={activity?.since ? Math.floor((nowS - activity.since) / 60) : 0}
                              />
                            )
                          })
                        : null}
                      {paused ? (
                        <View style={styles.paused}>
                          <T variant="label" color="text2">
                            {pausedLine(room, paused)}
                          </T>
                          <Pill
                            label={`Let ${nameList(paused.asked.map(memberId => memberName(room, memberId)))} answer`}
                            height={40}
                            style={styles.pausedPill}
                            onPress={() => send(answerPausedText(room, paused))}
                          />
                        </View>
                      ) : null}
                      {working && !replying.length && !liveTurns.length ? (
                        <T variant="label" color="text2" style={styles.replying}>
                          Replying…
                        </T>
                      ) : null}
                    </View>
                  ) : null
                }
                // Holds your place while you read older messages, and follows new ones while you're at the newest: the list does both in
                // the same layout pass. Pinning alone pushed a new message just below the screen whenever the pin landed after the
                // jump to the newest row (often, on Android), so it looked like nothing arrived.
                maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 80 }}
              />
            </StampReveal>
          </View>
        )}

        <Composer
          botName={room.name}
          running={working}
          value={text}
          onChangeText={setText}
          above={
            <>
              {replyTo ? <ReplyStrip who={replyTo.who} text={replyTo.text} onCancel={() => setReplyTo(null)} /> : null}
              <MentionChips members={room.members} metas={metas} onMention={mention} hint={askedHint} />
            </>
          }
          focusSignal={focusComposer}
          onSend={send}
          onStop={() => void stop()}
        />
      </KeyboardAvoidingView>

      <Sheet visible={options} onClose={() => setOptions(false)} label="Room options">
        <GroupedList>
          {working ? <Row label="Stop replies" chevron={false} onPress={() => void stop()} /> : null}
          <Row
            label="Disband room"
            destructive
            onPress={() => {
              setOptions(false)
              afterSheetCloses(() => setConfirmDisband(true))
            }}
          />
        </GroupedList>
      </Sheet>

      <ConfirmSheet
        visible={confirmDisband}
        title={`Disband ${room.name}?`}
        message="The room and its conversation are removed for good. The bots keep their own chats."
        confirmLabel="Disband room"
        destructive
        onClose={() => setConfirmDisband(false)}
        onConfirm={() => void disband()}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  list: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 20 },
  footer: { gap: 14, paddingTop: 4 },
  replying: {},
  paused: { gap: 10, alignItems: 'flex-start' },
  pausedPill: { paddingHorizontal: 18 },
})
