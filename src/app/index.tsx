import Feather from '@expo/vector-icons/Feather'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native'

import { BotRow } from '@/components/bots/BotRow'
import { DashboardStrip } from '@/components/bots/DashboardStrip'
import { HitRow } from '@/components/bots/HitRow'
import { NeedsYouSheet } from '@/components/bots/NeedsYouSheet'
import { RoomRow } from '@/components/rooms/RoomRow'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { roomMatches, type RoomView } from '@/features/rooms/view'
import { ageLabel, filterRoster } from '@/features/roster/derive'
import { homeList } from '@/features/roster/home'
import type { BotView } from '@/features/roster/view'
import { isMainChat, type SessionHit } from '@/lib/hermes/search'
import { holdOrder } from '@/lib/holdOrder'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { useDashboards } from '@/stores/dashboards'
import { useDeck } from '@/stores/deck'
import { useMessageSearch } from '@/stores/messageSearch'
import { useRoomViews, useRooms } from '@/stores/rooms'
import { useRoster } from '@/stores/roster'
import { useWatch } from '@/stores/watch'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** At most this many pinned bots get a card on Home. */
const PINNED_MAX = 12
/** How long the rows keep their places after a finger leaves the list or it stops scrolling. */
const HOLD_AFTER_MS = 1200

/** "my-server.ts.net" from "https://my-server.ts.net:9119/". */
function hostOf(baseUrl: string | undefined): string {
  return baseUrl?.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') ?? ''
}

export default function Home() {
  const { c } = useTheme()
  const router = useRouter()
  const status = useConnection(state => state.status)
  const baseUrl = useConnection(state => state.config?.baseUrl)
  const loaded = useRoster(state => state.loaded)
  const refresh = useRoster(state => state.refresh)
  const views = useBotViews()
  const roomViews = useRoomViews()
  const roomsReady = useRooms(state => state.available === true)
  const dashboardsReady = useDashboards(state => state.available === true)
  const dashboardSummary = useDashboards(state => state.summary)
  const dashboardNeeds = useMemo(() => Object.fromEntries(Object.entries(dashboardSummary).map(([profile, entry]) => [profile, entry.needs_you])), [dashboardSummary])
  const metas = useBotMetas()
  const deck = useDeck()
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [pulling, setPulling] = useState(false)
  const [creating, setCreating] = useState(false)
  const nowS = useNow(60)
  const hits = useMessageSearch(state => state.hits)
  const messagesSearching = useMessageSearch(state => state.searching)
  const hitsFor = useMessageSearch(state => state.forQuery)
  const searchError = useMessageSearch(state => state.error)

  // Past two letters, also look through what was said in the bots' chats (after a pause in typing). The bots on Home are the
  // ones searched; a message is a hit for the words as they were when it was asked, so older answers wait for the newer ones.
  const trimmed = query.trim()
  const searchProfiles = useMemo(() => views.map(view => view.profile), [views])
  const asking = searching && trimmed.length >= 2

  useEffect(() => {
    if (!asking) {
      useMessageSearch.getState().clear()

      return
    }

    const timer = setTimeout(() => void useMessageSearch.getState().run(trimmed, searchProfiles), 350)

    return () => clearTimeout(timer)
  }, [asking, trimmed, searchProfiles])

  // The bots, then the rooms in a group of their own below them (newest first, as the store sorts them).
  type Item =
    | { kind: 'bot'; key: string; view: BotView }
    | { kind: 'room'; key: string; view: RoomView }
    | { kind: 'messages'; key: string }
    | { kind: 'hit'; key: string; hit: SessionHit }
    | { kind: 'looking'; key: string }
    | { kind: 'unsearched'; key: string }

  const visible = useMemo<Item[]>(() => {
    const filtering = query.trim().length > 0
    const names = filtering ? new Set(filterRoster(views.map(view => view.row), query).map(row => row.name)) : null
    // Pinned bots stay in the list too: their card opens the dashboard, their row the chat.
    const bots = names ? views.filter(view => names.has(view.profile)) : views
    const rooms = filtering ? roomViews.filter(view => roomMatches(view, query)) : roomViews

    return [
      // Bots and rooms in one list: pinned bots first, then the rest by latest activity.
      ...homeList(bots, rooms, view => view.lastActive, view => view.lastActive).map((entry): Item =>
        entry.kind === 'bot' ? { kind: 'bot', key: `bot:${entry.view.profile}`, view: entry.view } : { kind: 'room', key: `room:${entry.view.id}`, view: entry.view },
      ),
      // What was said in the chats: shown for the words last searched, and a quiet line while the search runs.
      ...(asking && hits.length && hitsFor === trimmed ? [{ kind: 'messages', key: 'messages' } as Item, ...hits.map((hit): Item => ({ kind: 'hit', key: `hit:${hit.profile}:${hit.sessionId}`, hit }))] : []),
      ...(asking && messagesSearching && !(hits.length && hitsFor === trimmed) ? [{ kind: 'looking', key: 'looking' } as Item] : []),
      ...(asking && !messagesSearching && searchError ? [{ kind: 'unsearched', key: 'unsearched' } as Item] : []),
    ]
  }, [views, roomViews, query, asking, hits, hitsFor, trimmed, messagesSearching, searchError])

  // Rows keep their places while a finger is on the list and a moment after it stops, so new activity never moves a row
  // under a tap; then they take the order activity gives them.
  const [held, setHeld] = useState<string[] | null>(null)
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shown = useMemo(() => holdOrder(visible, item => item.key, held), [visible, held])

  function hold() {
    if (releaseTimer.current) {
      clearTimeout(releaseTimer.current)
      releaseTimer.current = null
    }

    // The order on screen now, unless one is already held.
    setHeld(current => current ?? visible.map(item => item.key))
  }

  function letGo() {
    if (releaseTimer.current) {
      clearTimeout(releaseTimer.current)
    }

    releaseTimer.current = setTimeout(() => {
      releaseTimer.current = null
      setHeld(null)
    }, HOLD_AFTER_MS)
  }

  useEffect(
    () => () => {
      if (releaseTimer.current) {
        clearTimeout(releaseTimer.current)
      }
    },
    [],
  )

  const pinned = useMemo(() => views.filter(view => view.pinned).slice(0, PINNED_MAX), [views])
  const deckContext = useMemo(() => ({ views, metas, nowS }), [views, metas, nowS])

  // The pinned bots' dashboards, for their tiles: read again when the server says one changed (the summary is polled).
  const dashboardKey = dashboardsReady ? pinned.map(view => `${view.profile}:${dashboardSummary[view.profile]?.updated ?? 0}`).join(',') : ''
  // Their tiles are on screen too: the server then reads their live panels (a balance, the next events), which change no
  // record and so never move the summary, and pushes when one moves, which reloads that dashboard.
  useWatch('dashboards', dashboardsReady ? pinned.map(view => view.profile) : [])

  useEffect(() => {
    for (const entry of dashboardKey ? dashboardKey.split(',') : []) {
      void useDashboards.getState().load(entry.slice(0, entry.lastIndexOf(':')))
    }
  }, [dashboardKey])
  const needsYou = views.filter(view => view.attention.state === 'needsYou')
  const roomsNeedYou = roomViews.filter(view => view.needsYou)
  const open = (profile: string) => router.push({ pathname: '/bot/[profile]', params: { profile } })
  // A pinned bot opens its dashboard where the server has hermes-dashboard; elsewhere its chat, as before.
  const openPinned = (profile: string) => (dashboardsReady ? router.push({ pathname: '/bot/[profile]/dashboard', params: { profile } }) : open(profile))
  const openRoom = (id: string) => router.push({ pathname: '/room/[id]', params: { id } })

  // A message found in a bot's main chat opens the bot as it always does. One in any other chat opens to read, because the
  // server will not hand every old chat back to a phone to write in (a Kanban worker's transcript, for one).
  function openHit(hit: SessionHit) {
    const canonical = useRoster.getState().rows.find(row => row.name === hit.profile)?.canonical_session

    if (isMainChat(hit, canonical)) {
      open(hit.profile)
    } else {
      router.push({ pathname: '/bot/[profile]/past', params: { profile: hit.profile, session: hit.sessionId, title: hit.title } })
    }
  }

  // Things on bots' dashboards that need you count too, and name their bot once.
  const dashboardNames = views.filter(view => (dashboardNeeds[view.profile] ?? 0) > 0 && view.attention.state !== 'needsYou').map(view => view.name)
  const names = [...needsYou.map(view => view.name), ...dashboardNames, ...roomsNeedYou.map(view => view.name)]
  const namesLine = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')

  async function onPull() {
    setPulling(true)
    await refresh()
    setPulling(false)
  }

  function renderRow(item: Item) {
    switch (item.kind) {
      case 'bot':
        return <BotRow view={item.view} onPress={() => open(item.view.profile)} />
      case 'room':
        return <RoomRow view={item.view} metas={metas} onPress={() => openRoom(item.view.id)} />
      case 'hit':
        return (
          <HitRow
            profile={item.hit.profile}
            name={views.find(view => view.profile === item.hit.profile)?.name ?? item.hit.profile}
            meta={metas[item.hit.profile]}
            chatTitle={isMainChat(item.hit, useRoster.getState().rows.find(row => row.name === item.hit.profile)?.canonical_session) ? '' : item.hit.title}
            snippet={item.hit.snippet}
            age={ageLabel(item.hit.lastActive, nowS)}
            onPress={() => openHit(item.hit)}
          />
        )
      case 'unsearched':
        return (
          <T variant="secondary" color="text2" style={styles.looking} selectable>
            Couldn’t look through chats: {searchError}
          </T>
        )
      case 'looking':
        return (
          <T variant="secondary" color="text2" style={styles.looking}>
            Looking through chats…
          </T>
        )
      default:
        return (
          <T variant="label" color="text2" style={styles.group} accessibilityRole="header">
            Messages
          </T>
        )
    }
  }

  const serverDot = status === 'online' ? c.connected : status === 'offline' ? c.danger : c.text2

  return (
    <Screen edges={['top']}>
      {searching ? (
        <View style={styles.header}>
          <View style={[styles.search, { backgroundColor: c.control }]}>
            <Feather name="search" size={16} color={c.text2} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search bots, rooms and messages"
              placeholderTextColor={c.text2}
              accessibilityLabel="Search bots, rooms and messages"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: c.text }]}
            />
          </View>
          <Pill
            label="Cancel"
            variant="ghost"
            onPress={() => {
              setSearching(false)
              setQuery('')
            }}
          />
        </View>
      ) : (
        <View style={styles.header}>
          <IconCircle icon="server" label={`Settings, ${hostOf(baseUrl)}, ${status}`} muted dot={serverDot} onPress={() => router.push('/settings')} />
          <View style={styles.fill} />
          <IconCircle icon="search" label="Search" onPress={() => setSearching(true)} />
          <IconCircle icon="monitor" label="Bot screens" onPress={() => router.push('/screens')} />
          <IconCircle icon="plus" label={roomsReady ? 'New bot or room' : 'New bot'} onPress={() => (roomsReady ? setCreating(true) : router.push('/bot/new'))} />
        </View>
      )}

      <FlatList
        data={shown}
        keyExtractor={item => item.key}
        onTouchStart={hold}
        onTouchEnd={letGo}
        onTouchCancel={letGo}
        onScrollBeginDrag={hold}
        onScrollEndDrag={letGo}
        onMomentumScrollBegin={hold}
        onMomentumScrollEnd={letGo}
        renderItem={({ item }: { item: Item }) => <View style={{ backgroundColor: c.sheet }}>{renderRow(item)}</View>}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}
        ListHeaderComponent={
          searching ? (
            <View style={[styles.sheetTop, styles.sheetTopSearch, { backgroundColor: c.sheet }]} />
          ) : (
            <>
              {status === 'offline' ? (
                <View style={styles.notice}>
                  <T variant="label" color="text2">
                    Can’t reach {hostOf(baseUrl) || 'the server'}. Retrying…
                  </T>
                </View>
              ) : null}
              {/* What is waiting on you, first thing on Home: several at once, raised, with Review all. */}
              <NeedsYouSheet
                count={deck.waiting}
                cards={deck.cards}
                context={deckContext}
                names={namesLine}
                loaded={loaded}
                onReview={() => router.push('/inbox')}
                onOpen={card => router.push({ pathname: '/inbox', params: { start: card.key } })}
              />
              {/* The pinned bots' dashboards, where the server has them; their chats are the first rows below. */}
              {dashboardsReady ? <DashboardStrip views={pinned} onOpen={openPinned} nowS={nowS} /> : null}
              {/* The list is a sheet of paper over the canvas: its rounded top here, the rows on it, and its foot to the bottom. */}
              <View style={[styles.sheetTop, { backgroundColor: c.sheet }]} />
            </>
          )
        }
        ListFooterComponent={<View style={[styles.sheetFoot, { backgroundColor: c.sheet }]} />}
        ListFooterComponentStyle={styles.fill}
        ListEmptyComponent={
          <View style={[styles.empty, { backgroundColor: c.sheet }]}>
            {!loaded ? (
              <T variant="secondary" color="text2">
                {status === 'online' ? 'Loading your bots…' : 'Connecting…'}
              </T>
            ) : query.trim() ? (
              <T variant="secondary" color="text2">
                Nothing matches “{query.trim()}”.
              </T>
            ) : (
              <>
                <T variant="heading">No bots yet</T>
                <T variant="secondary" color="text2" style={styles.centered}>
                  Bots are Hermes profiles. Create one on your server and it will appear here.
                </T>
              </>
            )}
          </View>
        }
        contentContainerStyle={styles.content}
      />

      <Sheet visible={creating} onClose={() => setCreating(false)} label="Create">
        <GroupedList>
          <Row
            label="New bot"
            onPress={() => {
              setCreating(false)
              router.push('/bot/new')
            }}
          />
          <Row
            label="New room"
            onPress={() => {
              setCreating(false)
              router.push('/room/new')
            }}
          />
        </GroupedList>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingLeft: 20, paddingTop: 8, paddingBottom: 8, minHeight: 56 },
  search: { flex: 1, height: 40, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  searchInput: { flex: 1, padding: 0, fontFamily: fonts.regular, fontSize: 15 },
  content: { flexGrow: 1 },
  sheetTop: { height: 10, marginTop: 22, borderTopLeftRadius: radius.tray, borderTopRightRadius: radius.tray },
  sheetTopSearch: { marginTop: 4 },
  sheetFoot: { flex: 1, minHeight: 32 },
  group: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  looking: { paddingHorizontal: 20, paddingTop: 16 },
  notice: { paddingHorizontal: 20, paddingBottom: 4 },
  empty: { alignItems: 'center', gap: 6, paddingTop: 72, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
})
