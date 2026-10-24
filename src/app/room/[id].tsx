import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, StyleSheet, View } from 'react-native'

import { Composer } from '@/components/chat/Composer'
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
import { activityPhrase, answerPausedText, roomAttention, buildTimeline, memberName, memberOf, nameList, pausedAsk, pausedLine, replyingLine, type TimelineItem } from '@/lib/hermes/rooms'
import { useNow } from '@/lib/useNow'
import { useStickToLatest } from '@/lib/useStickToLatest'
import { useBotMetas } from '@/stores/bots'
import { removeRoom, sendToRoom, startRoomPoll, stopRoomWork, useRoomData } from '@/stores/rooms'
import { useOnScreen } from '@/stores/presence'
import { toast } from '@/stores/toast'

/** A group room: you and several bots in one conversation, run by the server so it carries on with the app closed. */
export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const data = useRoomData(id)
  const metas = useBotMetas()
  const nowS = useNow(60)
  const [text, setText] = useState('')
  const [options, setOptions] = useState(false)
  const [confirmDisband, setConfirmDisband] = useState(false)

  // Only while the room is on top (a room left under another screen stops reading its log).
  useFocusEffect(useCallback(() => startRoomPoll(id), [id]))
  // While the room is open, the server pushes nothing about it to this phone.
  useOnScreen(data?.sessions ?? [])

  const room = data?.room
  const working = data?.status?.working === true
  const replying = data?.replying ?? []
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

  function send(message: string) {
    // Sending takes you to the bottom, where your message and the replies will appear.
    stick.toLatest()
    setText('')
    void sendToRoom(id, message).then(error => error && toast(error))
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
            <FlatList
              ref={list}
              inverted
              data={items}
              keyExtractor={item => item.id}
              renderItem={({ item }) => <RoomMessage item={item} handles={handles} metas={metas} now={nowS * 1000} />}
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
                attention?.actions.length || data.questions?.length || working || paused ? (
                  <View style={styles.footer}>
                    {attention?.actions.length || data.questions?.length ? <RoomActions room={room} actions={attention?.actions ?? []} questions={data.questions} framed /> : null}
                    {working && replying.length
                      ? replying.map(memberId => {
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
                    {working && !replying.length ? (
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
          </View>
        )}

        <Composer
          botName={room.name}
          running={working}
          value={text}
          onChangeText={setText}
          above={<MentionChips members={room.members} metas={metas} onMention={mention} />}
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
