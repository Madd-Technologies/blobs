import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { BotFace } from '@/components/bots/BotFace'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { buildChatEntries, type ChatEntry } from '@/features/sessions/chats'
import { afterSheetCloses } from '@/lib/afterSheet'
import { chatInStack } from '@/lib/stack'
import { useNow } from '@/lib/useNow'
import { useBotView } from '@/stores/bots'
import { useChatList } from '@/stores/chats'
import { useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'
import { sessions, useBotSession, useChosenChat } from '@/stores/sessions'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
function since(thenS: number, nowS: number): string {
  if (!thenS) {
    return ''
  }

  const diff = Math.max(0, nowS - thenS)

  if (diff < 60) {
    return 'just now'
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)} min ago`
  }

  if (diff < 86_400) {
    return `${Math.floor(diff / 3600)} h ago`
  }

  return diff < 14 * 86_400 ? `${Math.floor(diff / 86_400)} d ago` : new Date(thenS * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** One bot's chats: start a new one, go back to the main one, or open an older one. */
export default function Chats() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const navigation = useNavigation()
  const { c } = useTheme()
  const view = useBotView(profile)
  const session = useBotSession(profile)
  const chosen = useChosenChat(profile)
  const online = useConnection(state => state.status === 'online')
  const canonical = useRoster(state => state.rows.find(row => row.name === profile)?.canonical_session)
  const nowS = useNow()
  const list = useChatList(state => state.byBot[profile])
  const listed = list?.listed ?? null
  const inbox = list?.inbox ?? null
  const failed = list?.error ?? null
  const [pressed, setPressed] = useState<ChatEntry | null>(null)
  const [deleting, setDeleting] = useState<ChatEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const name = view?.name ?? profile

  useEffect(() => {
    if (online) {
      void useChatList.getState().load(profile)
    }
  }, [online, profile])

  const entries = useMemo(
    () =>
      buildChatEntries({
        listed: listed ?? [],
        main: {
          id: canonical?.id ?? null,
          resolvedId: canonical?.resolved_id,
          preview: canonical?.preview,
          startedAt: canonical?.last_active,
          messageCount: canonical?.message_count,
        },
        inbox,
        openId: session?.storedId ?? chosen ?? null,
        elsewhere: !!chosen,
      }),
    [listed, canonical, inbox, session?.storedId, chosen],
  )

  const main = entries.find(entry => entry.main)
  const between = entries.find(entry => entry.inbox)
  const side = entries.filter(entry => !entry.main && !entry.inbox)

  /** Back to the bot's chat when it is in the stack; reached by a link (Home underneath) the chat takes this screen's place. */
  const toChat = () =>
    chatInStack(navigation.getState()?.routes, profile)
      ? router.dismissTo({ pathname: '/bot/[profile]', params: { profile } })
      : router.replace({ pathname: '/bot/[profile]', params: { profile } })

  async function open(entry: ChatEntry) {
    if (entry.current) {
      toChat()

      return
    }

    if (!chatInStack(navigation.getState()?.routes, profile)) {
      // Reached by a link, with no chat underneath: the chat opens the one named, the way a notification's link does.
      if (!entry.id) {
        sessions.leaveSide(profile)
      }

      router.replace({ pathname: '/bot/[profile]', params: entry.id ? { profile, chat: entry.id } : { profile } })

      return
    }

    setBusy(true)
    toChat()
    await sessions.openChat(profile, entry.main ? null : entry.id)
  }

  async function startNew() {
    setBusy(true)
    const error = await sessions.newChat(profile)
    setBusy(false)

    if (error) {
      toast(error)

      return
    }

    toChat()
  }

  async function remove(entry: ChatEntry) {
    const error = await sessions.deleteChat(profile, entry.id)

    if (error) {
      toast(error)
    }

    void useChatList.getState().load(profile)
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <T variant="heading" style={styles.title} numberOfLines={1} accessibilityRole="header">
            {name} · Chats
          </T>
          <IconCircle icon="edit" label="New side chat" diameter={40} onPress={() => void startNew()} disabled={busy || !online} />
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {listed === null && !failed ? (
            <View style={styles.center}>
              <Spinner size={16} />
            </View>
          ) : (
            <>
              {failed ? (
                <T variant="label" color="danger" style={styles.note}>
                  {failed}
                </T>
              ) : null}

              {main ? (
                <GroupedList>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Main chat${main.current ? ', open now' : ''}`}
                    onPress={() => void open(main)}
                    style={({ pressed: down }) => [styles.mainRow, { backgroundColor: down ? c.sheet : 'transparent' }]}
                  >
                    <BotFace name={profile} meta={view?.meta} size={40} />
                    <View style={styles.rowText}>
                      <T variant="rowTitle" numberOfLines={1}>
                        Main chat
                      </T>
                      {main.preview ? (
                        <T variant="label" color="text2" numberOfLines={1}>
                          {main.preview}
                        </T>
                      ) : null}
                    </View>
                    <T variant="meta" color={main.current ? 'text' : 'text2'}>
                      {main.current ? 'Open' : since(main.startedAt, nowS)}
                    </T>
                  </Pressable>
                  {between ? (
                    // What other bots asked this one, and its answers: kept out of the main chat, here to read.
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Between bots, read only"
                      onPress={() => router.push({ pathname: '/bot/[profile]/past', params: { profile, session: between.id, title: between.title, inbox: '1' } })}
                      style={({ pressed: down }) => [styles.row, { backgroundColor: down ? c.sheet : 'transparent' }]}
                    >
                      <View style={styles.rowText}>
                        <T variant="body" numberOfLines={1}>
                          {between.title}
                        </T>
                        {between.preview ? (
                          <T variant="label" color="text2" numberOfLines={1}>
                            {between.preview}
                          </T>
                        ) : null}
                      </View>
                      <T variant="meta" color="text2">
                        {since(between.startedAt, nowS)}
                      </T>
                    </Pressable>
                  ) : null}
                </GroupedList>
              ) : null}

              {side.length ? (
                <View style={styles.group}>
                  <T variant="meta" color="text2" style={styles.section}>
                    Side chats
                  </T>
                  <GroupedList>
                    {side.map(entry => (
                      <Pressable
                        key={entry.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${entry.title}${entry.current ? ', open now' : ''}`}
                        onPress={() => void open(entry)}
                        onLongPress={() => setPressed(entry)}
                        style={({ pressed: down }) => [styles.row, { backgroundColor: down ? c.sheet : 'transparent' }]}
                      >
                        <View style={styles.rowText}>
                          <T variant="body" numberOfLines={1} style={entry.current ? styles.bold : undefined}>
                            {entry.title}
                          </T>
                          {entry.preview ? (
                            <T variant="label" color="text2" numberOfLines={1}>
                              {entry.preview}
                            </T>
                          ) : null}
                        </View>
                        <T variant="meta" color={entry.current ? 'text' : 'text2'}>
                          {entry.current ? 'Open' : since(entry.startedAt, nowS)}
                        </T>
                      </Pressable>
                    ))}
                  </GroupedList>
                </View>
              ) : null}

              <T variant="label" color="text2" style={styles.foot}>
                {name}’s main chat is its one long conversation.{between ? ` Messages from other bots go to Between bots instead, to read only.` : ''} Side chats are scratch space and stay here until you delete them: hold one to delete it.
              </T>
            </>
          )}
        </ScrollView>

        <Sheet visible={pressed !== null} onClose={() => setPressed(null)} label="Chat options">
          <GroupedList>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete chat"
              style={styles.sheetRow}
              onPress={() => {
                const chosen = pressed
                setPressed(null)
                // iOS drops a sheet presented while another is still going away.
                afterSheetCloses(() => setDeleting(chosen))
              }}
            >
              <T variant="body" color="danger">
                Delete chat
              </T>
            </Pressable>
          </GroupedList>
        </Sheet>

        <ConfirmSheet
          visible={deleting !== null}
          title="Delete this chat?"
          message={deleting ? `“${deleting.title}” and its messages are removed from the server. This can’t be undone.` : undefined}
          confirmLabel="Delete"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={() => deleting && void remove(deleting)}
        />
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  center: { alignItems: 'center', paddingTop: 80 },
  note: { paddingHorizontal: 4 },
  row: { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mainRow: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  group: { gap: 8 },
  section: { paddingHorizontal: 16 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  bold: { fontFamily: 'Geist_600SemiBold' },
  foot: { paddingHorizontal: 8, textAlign: 'center' },
  sheetRow: { minHeight: 52, paddingHorizontal: 16, justifyContent: 'center' },
})
