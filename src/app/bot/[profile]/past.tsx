import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BotFace } from '@/components/bots/BotFace'
import { ChatRow } from '@/components/chat/ChatRow'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { isInboxTitle } from '@/features/sessions/chats'
import { buildDisplay, type DisplayItem } from '@/features/transcript/display'
import { itemsFromHistory, settleStaleSteps } from '@/features/transcript/history'
import { useNow } from '@/lib/useNow'
import { useViewableRows } from '@/lib/useViewableRows'
import { useBotView, useFaceColor } from '@/stores/bots'
import { usePast } from '@/stores/past'
import { usePrefs } from '@/stores/prefs'
import { sessions } from '@/stores/sessions'
import { BotTint } from '@/theme/ThemeProvider'

/**
 * A chat from the past, to read: what a search found, or any chat the server will not (or should not) hand back to a phone
 * to write in. "Continue this chat" tries to open it for writing, and says why when the server will not. A bot's inbox
 * (Between bots) is only ever read here: everything in it is between bots, so all of it shows, and it is never continued.
 */
export default function PastChatScreen() {
  const { profile, session, title, inbox: inboxParam } = useLocalSearchParams<{ profile: string; session: string; title?: string; inbox?: string }>()
  // Also when a search opens it: the result carries the chat's own title.
  const inbox = inboxParam === '1' || isInboxTitle(title ?? '')
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const view = useBotView(profile)
  const tint = useFaceColor(profile)
  const past = usePast(state => state.byId[session])
  const showThinking = usePrefs(state => state.showThinking)
  const chatterPref = usePrefs(state => state.showBotChatter)
  // In the inbox every turn is between bots: hiding that would hide the whole chat.
  const showChatter = inbox || chatterPref
  const nowS = useNow(60)
  const [continuing, setContinuing] = useState(false)
  // Why the server would not open this chat for writing, kept on screen: it is a sentence to read, not a blip.
  const [refusal, setRefusal] = useState<string | null>(null)
  const name = view?.name ?? profile
  // Only what is on screen loads its pictures.
  const viewable = useViewableRows(`past:${session}`)

  useEffect(() => {
    void usePast.getState().load(profile, session)
  }, [profile, session])

  // Newest first, for the inverted list.
  const data = useMemo<DisplayItem[]>(() => buildDisplay(settleStaleSteps(itemsFromHistory(past?.rows ?? [])), { now: nowS * 1000, showThinking, showChatter }).reverse(), [past?.rows, nowS, showThinking, showChatter])

  async function carryOn() {
    setContinuing(true)
    setRefusal(null)

    try {
      await sessions.openChat(profile, session)
      const opened = sessions.store.getState().bots[profile]

      if (opened?.phase === 'error' && !opened.transcript.items.length) {
        // The server said no: the bot goes back to its main chat, and the reason is shown here.
        setRefusal(opened.error ?? 'The server will not open this chat here.')
        sessions.leaveSide(profile)

        return
      }

      router.replace({ pathname: '/bot/[profile]', params: { profile } })
    } finally {
      setContinuing(false)
    }
  }

  const loading = !past || past.loading

  return (
    <BotTint color={tint}>
      <Screen edges={['top']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <BotFace name={profile} meta={view?.meta} size={30} />
          <View style={styles.title}>
            <T variant="heading" numberOfLines={1}>
              {inbox ? 'Between bots' : title?.trim() || 'Earlier chat'}
            </T>
            <T variant="label" color="text2" numberOfLines={1}>
              {inbox ? `What other bots asked ${name} · read only` : `${name} · read only`}
            </T>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <Spinner size={18} />
          </View>
        ) : past.error && !data.length ? (
          <View style={styles.center}>
            <T variant="secondary" color="text2" style={styles.centered} selectable>
              {past.error}
            </T>
            <Pill label="Try again" variant="secondary" onPress={() => void usePast.getState().load(profile, session)} />
          </View>
        ) : !data.length ? (
          <View style={styles.center}>
            <T variant="secondary" color="text2" style={styles.centered}>
              {inbox ? `No bot has messaged ${name} yet.` : 'Nothing was said in this chat.'}
            </T>
          </View>
        ) : (
          <FlatList
            inverted
            data={data}
            keyExtractor={entry => (entry.kind === 'date' ? entry.id : entry.item.id)}
            renderItem={({ item }) => <ChatRow entry={item} list={`past:${session}`} profile={profile} botName={name} />}
            {...viewable}
            contentContainerStyle={styles.list}
            onEndReachedThreshold={0.5}
            onEndReached={() => void usePast.getState().loadOlder(profile, session)}
            ListFooterComponent={past.loadingOlder ? <Spinner size={14} /> : null}
          />
        )}

        {inbox ? (
          // Writing here would hold the inbox open, and the next bot's message would be turned away as busy.
          <View style={{ height: Math.max(insets.bottom, 12) }} />
        ) : (
          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {refusal ? (
              <T variant="label" color="text2" style={styles.refusal} selectable>
                {refusal}
              </T>
            ) : null}
            <Pill label="Continue this chat" variant="secondary" loading={continuing} onPress={() => void carryOn()} />
          </View>
        )}
      </Screen>
    </BotTint>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  bar: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  refusal: { textAlign: 'center', paddingHorizontal: 8 },
})
