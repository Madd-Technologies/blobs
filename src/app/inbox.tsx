import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotFace } from '@/components/bots/BotFace'
import { MuteSheet } from '@/components/dashboard/MuteSheet'
import { BehindCard, StackTopCard, SwipeCard, TopCard, cardAge, cardLine, cardName, type DeckContext } from '@/components/inbox/Deck'
import { RoomFaces } from '@/components/rooms/RoomFaces'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import { formatTyped, isPast, untilLabel } from '@/features/dashboard/view'
import {
  collapseDeckStacks,
  deckSummary,
  filterDeck,
  leftLabel,
  orderDeck,
  staleBoardIds,
  startAt,
  triagePrompt,
  turnEntries,
  type CardSource,
  type DeckCard,
} from '@/features/inbox/deck'
import { useNow } from '@/lib/useNow'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useDashboards } from '@/stores/dashboards'
import { useDeck } from '@/stores/deck'
import { useDrafts } from '@/stores/drafts'
import { sessions } from '@/stores/sessions'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

type BoardCard = Extract<DeckCard, { kind: 'board' }>

const SOURCE_LABELS: { key: CardSource; label: string }[] = [
  { key: 'bot', label: 'Bots' },
  { key: 'dashboard', label: 'Dashboards' },
  { key: 'phone', label: 'Phone' },
  { key: 'room', label: 'Rooms' },
]

/**
 * Needs you: swipe cards one at a time in Deck mode, or switch to List mode to filter by urgency/bot,
 * batch-complete or snooze dashboard cards, or hand a noisy queue to its bot to triage.
 */
export default function Inbox() {
  const router = useRouter()
  const { c } = useTheme()
  const { start, bucket: paramBucket, mode: paramMode } = useLocalSearchParams<{ start?: string; bucket?: 'all' | 'blocked' | 'review'; mode?: 'deck' | 'list' }>()
  const { cards, waiting } = useDeck()
  const views = useBotViews({ includeHidden: true })
  const metas = useBotMetas()
  const nowS = useNow()

  const pendingBoard = Math.max(0, waiting - cards.length)
  const summary = useMemo(() => deckSummary(cards, pendingBoard), [cards, pendingBoard])

  const [bucket, setBucket] = useState<'all' | 'blocked' | 'review'>(() => (paramBucket === 'blocked' || paramBucket === 'review' ? paramBucket : 'all'))
  const [botFilter, setBotFilter] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<CardSource | null>(null)
  const modeTouched = useRef(Boolean(paramMode))
  const [mode, setMode] = useState<'deck' | 'list'>(() => paramMode ?? (paramBucket === 'review' && summary.reviewCount > 8 && !start ? 'list' : 'deck'))

  // Switch large review queues to List mode automatically once dashboard items finish hydrating, unless the user chose a mode.
  useEffect(() => {
    if (!paramMode && !start && !modeTouched.current && bucket === 'review' && summary.reviewCount > 8 && mode !== 'list') {
      setMode('list')
    }
  }, [paramMode, start, bucket, summary.reviewCount, mode])

  // Cards skipped for now (to the back, in order), and records optimistically removed pending server confirmation.
  const [skipped, setSkipped] = useState<string[]>(() => startAt(cards, start))
  const [turns, setTurns] = useState(0)
  const [gone, setGone] = useState<string[]>([])
  const [frame, setFrame] = useState({ view: 0, content: 0 })
  const scrolls = frame.content > frame.view + 1
  const [muting, setMuting] = useState<BoardCard | null>(null)
  const [selected, setSelected] = useState<Record<string, true>>({})
  const [bulkMuting, setBulkMuting] = useState<BoardCard[] | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const context = useMemo<DeckContext>(() => ({ views, metas, nowS }), [views, metas, nowS])

  const visibleCards = useMemo(() => cards.filter(card => !gone.includes(card.key)), [cards, gone])
  const filtered = useMemo(() => filterDeck(visibleCards, { urgency: bucket, profile: botFilter, source: sourceFilter }), [visibleCards, bucket, botFilter, sourceFilter])
  const deck = useMemo(() => orderDeck(filtered, skipped), [filtered, skipped])
  const deckEntries = useMemo(() => collapseDeckStacks(deck, 4), [deck])

  const boardCards = useMemo(() => deck.filter((card): card is BoardCard => card.kind === 'board'), [deck])
  const selectedCards = useMemo(() => boardCards.filter(card => selected[card.key]), [boardCards, selected])
  const staleKeys = useMemo(() => new Set(staleBoardIds(boardCards, nowS, 7).map(item => item.key)), [boardCards, nowS])
  const staleBoardCards = useMemo(() => boardCards.filter(card => staleKeys.has(card.key)), [boardCards, staleKeys])

  // Prefetch the next couple of dashboard records in Deck mode so flipping forward feels instant.
  useEffect(() => {
    if (mode !== 'deck') {
      return
    }

    const cached = useDashboards.getState().records

    for (const candidate of deck.slice(0, 3)) {
      if (candidate.kind === 'board' && !cached[candidate.record.row.id]) {
        void useDashboards.getState().loadRecord(candidate.record.row.id)
      }
    }
  }, [mode, deck])

  const [topEntry, nextEntry, thirdEntry] = deckEntries
  const behind = nextEntry ? (thirdEntry ? 2 : 1) : 0
  const botName = (profile: string) => views.find(view => view.profile === profile)?.name ?? profile

  // Offer a 1-tap bot triage prompt when the visible review cards point cleanly to one bot with enough volume.
  const triageScope = useMemo(() => {
    if (!boardCards.length) {
      return null
    }

    const profiles = [...new Set(boardCards.map(card => card.profile))]

    if (profiles.length !== 1) {
      return null
    }

    if (!botFilter && boardCards.length < 4) {
      return null
    }

    if (botFilter && boardCards.length < 2) {
      return null
    }

    const profile = profiles[0]!
    const viewTitles = [...new Set(boardCards.map(card => card.record.view_title).filter(Boolean))]

    return { profile, count: boardCards.length, viewTitle: viewTitles.length === 1 ? viewTitles[0] : undefined }
  }, [boardCards, botFilter])

  async function askBotToTriage(override?: { profile: string; count: number; viewTitle?: string }) {
    const scope = override ?? triageScope

    if (!scope) {
      return
    }

    const { profile, count, viewTitle } = scope
    await sessions.newChat(profile)
    useDrafts.getState().set(profile, triagePrompt(botName(profile), count, viewTitle))
    router.push({ pathname: '/bot/[profile]', params: { profile } })
  }

  async function markDone(card: BoardCard) {
    const { profile } = card
    const id = card.record.row.id
    const forget = () => setGone(keys => keys.filter(key => key !== card.key))
    setGone(keys => [...keys, card.key])
    const error = await useDashboards.getState().setClosed(profile, id, true)

    if (error) {
      forget()
      toast(error)
    } else {
      toast('Marked done', {
        label: 'Undo',
        run: () => {
          forget()
          void useDashboards.getState().setClosed(profile, id, false).then(failed => failed && toast(failed))
        },
      })
    }
  }

  async function mute(card: BoardCard, until: number) {
    const { profile } = card
    const id = card.record.row.id
    const error = await useDashboards.getState().mute(profile, id, until)

    if (error) {
      toast(error)
    } else {
      toast(`Muted until ${untilLabel(until, nowS)}`, { label: 'Undo', run: () => void useDashboards.getState().mute(profile, id, null) })
    }
  }

  async function runBulkDone(targets: BoardCard[]) {
    if (!targets.length || bulkBusy) {
      return
    }

    const keys = targets.map(card => card.key)
    const items = targets.map(card => ({ profile: card.profile, id: card.record.row.id }))
    const keyById = new Map(targets.map(card => [card.record.row.id, card.key]))
    const forgetKeys = (drop: string[]) => setGone(current => current.filter(key => !drop.includes(key)))

    setBulkBusy(true)
    setGone(current => [...new Set([...current, ...keys])])
    setSelected(current => {
      const nextSelection = { ...current }

      for (const key of keys) {
        delete nextSelection[key]
      }

      return nextSelection
    })

    const result = await useDashboards.getState().bulkSetClosed(items, true)
    setBulkBusy(false)

    if (result.error) {
      forgetKeys(keys)
      toast(result.error)

      return
    }

    const failedIds = new Set(result.failed.map(item => item.id))
    const restoreKeys = result.failed.map(item => keyById.get(item.id)).filter((key): key is string => !!key)

    if (restoreKeys.length) {
      forgetKeys(restoreKeys)
    }

    const succeeded = items.filter(item => !failedIds.has(item.id))
    const succeededKeys = keys.filter(key => !restoreKeys.includes(key))

    if (result.failed.length) {
      toast(`${succeeded.length} done, ${result.failed.length} failed`)
    } else if (succeeded.length) {
      toast(`${succeeded.length} marked done`, {
        label: 'Undo',
        run: () => {
          forgetKeys(succeededKeys)
          void useDashboards.getState().bulkSetClosed(succeeded, false).then(undo => undo.error && toast(undo.error))
        },
      })
    }
  }

  async function runBulkMute(targets: BoardCard[], until: number) {
    if (!targets.length || bulkBusy) {
      return
    }

    const keys = targets.map(card => card.key)
    const items = targets.map(card => ({ profile: card.profile, id: card.record.row.id }))
    const keyById = new Map(targets.map(card => [card.record.row.id, card.key]))
    const forgetKeys = (drop: string[]) => setGone(current => current.filter(key => !drop.includes(key)))

    setBulkBusy(true)
    setGone(current => [...new Set([...current, ...keys])])
    setSelected(current => {
      const nextSelection = { ...current }

      for (const key of keys) {
        delete nextSelection[key]
      }

      return nextSelection
    })

    const result = await useDashboards.getState().bulkMute(items, until)
    setBulkBusy(false)

    if (result.error) {
      forgetKeys(keys)
      toast(result.error)

      return
    }

    const failedIds = new Set(result.failed.map(item => item.id))
    const restoreKeys = result.failed.map(item => keyById.get(item.id)).filter((key): key is string => !!key)

    if (restoreKeys.length) {
      forgetKeys(restoreKeys)
    }

    const succeeded = items.filter(item => !failedIds.has(item.id))
    const succeededKeys = keys.filter(key => !restoreKeys.includes(key))

    if (result.failed.length) {
      toast(`${succeeded.length} snoozed, ${result.failed.length} failed`)
    } else if (succeeded.length) {
      toast(`Snoozed ${succeeded.length} until ${untilLabel(until, nowS)}`, {
        label: 'Undo',
        run: () => {
          forgetKeys(succeededKeys)
          void useDashboards.getState().bulkMute(succeeded, null).then(undo => undo.error && toast(undo.error))
        },
      })
    }
  }

  function toggleSelection(key: string) {
    setSelected(current => {
      if (current[key]) {
        const { [key]: _dropped, ...rest } = current

        return rest
      }

      return { ...current, [key]: true }
    })
  }

  function onTurn(way: 'next' | 'previous', by = 1) {
    setSkipped(turnEntries(deckEntries, way, by))
    setTurns(count => count + 1)
  }

  function onSwipe(card: DeckCard, direction: 'right' | 'left') {
    if (card.kind !== 'board') {
      onTurn('next')
    } else if (direction === 'right') {
      void markDone(card)
    } else {
      setMuting(card)
    }
  }

  function switchMode() {
    modeTouched.current = true
    setMode(current => (current === 'deck' ? 'list' : 'deck'))
  }

  const isRecord = topEntry?.kind === 'board'
  const turnable = deckEntries.length > 1
  const sideways = !!topEntry && (isRecord || turnable)
  const upDown = turnable && !scrolls
  const activeSources = SOURCE_LABELS.filter(item => summary.sources[item.key] > 0 || sourceFilter === item.key)
  const showBucketChips = (summary.blockedCount > 0 && summary.reviewCount > 0) || bucket !== 'all'
  const showSourceChips = activeSources.length > 1 || sourceFilter !== null
  const hasFilters = summary.totalCount > 0 || bucket !== 'all' || botFilter !== null || sourceFilter !== null
  const headerSubtitle =
    filtered.length !== visibleCards.length
      ? `${filtered.length} shown · ${visibleCards.length} left`
      : leftLabel(visibleCards.length)

  const bulkProfiles = useMemo(
    () => (bulkMuting ? [...new Set(bulkMuting.map(card => card.profile))] : []),
    [bulkMuting],
  )
  const bulkBotName = bulkProfiles.length === 1 ? botName(bulkProfiles[0]!) : 'Your bots'

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        title="Needs you"
        subtitle={headerSubtitle}
        right={
          cards.length > 0 ? (
            <IconCircle
              icon={mode === 'deck' ? 'list' : 'layers'}
              label={mode === 'deck' ? 'Switch to list view' : 'Switch to deck view'}
              onPress={switchMode}
            />
          ) : undefined
        }
      />

      {hasFilters ? (
        <View style={styles.filterWrap}>
          <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <FilterChip
              label={`All (${summary.totalCount})`}
              active={bucket === 'all' && botFilter === null && sourceFilter === null}
              onPress={() => {
                setBucket('all')
                setBotFilter(null)
                setSourceFilter(null)
              }}
            />
            {showBucketChips && (summary.blockedCount > 0 || bucket === 'blocked') ? (
              <FilterChip
                label={`Blocked (${summary.blockedCount})`}
                active={bucket === 'blocked'}
                onPress={() => setBucket(bucket === 'blocked' ? 'all' : 'blocked')}
              />
            ) : null}
            {showBucketChips && (summary.reviewCount > 0 || bucket === 'review') ? (
              <FilterChip
                label={`Review (${summary.reviewCount})`}
                active={bucket === 'review'}
                onPress={() => setBucket(bucket === 'review' ? 'all' : 'review')}
              />
            ) : null}
            {showSourceChips
              ? activeSources.map(item => (
                  <FilterChip
                    key={item.key}
                    label={`${item.label} (${summary.sources[item.key]})`}
                    active={sourceFilter === item.key}
                    onPress={() => setSourceFilter(sourceFilter === item.key ? null : item.key)}
                  />
                ))
              : null}
            {summary.bots.length > 1 || botFilter !== null
              ? summary.bots.map(bot => {
                  const active = botFilter === bot.profile

                  return (
                    <Press
                      key={bot.profile}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${botName(bot.profile)}, ${bot.total} items`}
                      onPress={() => setBotFilter(active ? null : bot.profile)}
                      style={[styles.chip, { backgroundColor: active ? c.primary : c.control }]}
                    >
                      <BotFace name={bot.profile} meta={metas[bot.profile]} size={18} />
                      <T variant="label" color={active ? 'onPrimary' : 'text'} style={styles.chipText}>
                        {botName(bot.profile)} ({bot.total})
                      </T>
                    </Press>
                  )
                })
              : null}
          </ScrollView>
        </View>
      ) : null}

      {mode === 'list' ? (
        <View style={styles.flex}>
          {boardCards.length > 0 || triageScope ? (
            <View style={styles.toolbar}>
              {boardCards.length > 0 ? (
                <View style={styles.toolbarLeft}>
                  <Press
                    accessibilityRole="button"
                    onPress={() => {
                      if (selectedCards.length === boardCards.length) {
                        setSelected({})
                      } else {
                        setSelected(Object.fromEntries(boardCards.map(card => [card.key, true as const])))
                      }
                    }}
                    style={[styles.toolBtn, { backgroundColor: c.control }]}
                  >
                    <T variant="label" color="text">
                      {selectedCards.length === boardCards.length ? `Clear (${selectedCards.length})` : `Select all (${boardCards.length})`}
                    </T>
                  </Press>
                    {selectedCards.length > 0 && selectedCards.length < boardCards.length ? (
                    <Press
                      accessibilityRole="button"
                      onPress={() => setSelected({})}
                      style={[styles.toolBtn, { backgroundColor: c.control }]}
                    >
                      <T variant="label" color="text2">
                        Clear ({selectedCards.length})
                      </T>
                    </Press>
                  ) : null}
                  {staleBoardCards.length > 0 ? (
                    <Press
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${staleBoardCards.length} items older than 7 days done`}
                      onPress={() => void runBulkDone(staleBoardCards)}
                      style={[styles.toolBtn, { backgroundColor: c.control }]}
                    >
                      <T variant="label" color="text">
                        Clear &gt;7d ({staleBoardCards.length})
                      </T>
                    </Press>
                  ) : null}
                </View>
              ) : (
                <View style={styles.flex} />
              )}
              {triageScope ? (
                <Pill
                  label={`Ask ${botName(triageScope.profile)} to triage`}
                  variant="secondary"
                  icon="message-circle"
                  height={36}
                  onPress={() => void askBotToTriage()}
                />
              ) : null}
            </View>
          ) : null}

          <FlatList
            data={deck}
            keyExtractor={item => item.key}
            contentContainerStyle={[styles.listContent, selectedCards.length > 0 && styles.listWithBar]}
            renderItem={({ item, index }) => {
              const isFirst = index === 0
              const isLast = index === deck.length - 1
              const radiusStyle = {
                borderTopLeftRadius: isFirst ? radius.group : 0,
                borderTopRightRadius: isFirst ? radius.group : 0,
                borderBottomLeftRadius: isLast ? radius.group : 0,
                borderBottomRightRadius: isLast ? radius.group : 0,
              }

              if (item.kind === 'board') {
                const checked = !!selected[item.key]
                const row = item.record.row
                const title = row.title ? formatTyped(row.title, item.nowS) : 'Untitled'
                const sub = row.subtitle ? formatTyped(row.subtitle, item.nowS) : ''
                const meta = row.meta ? formatTyped(row.meta, item.nowS) : ''
                const urgentMeta =
                  !!row.meta &&
                  ((row.meta.type === 'date' && isPast(String(row.meta.value), item.nowS + 86_400)) ||
                    (row.meta.type === 'datetime' && Number(row.meta.value) <= item.nowS + 86_400))

                return (
                  <View style={[radiusStyle, { backgroundColor: c.sheet }]}>
                    {index > 0 ? <View style={[styles.listSep, { backgroundColor: c.separator }]} /> : null}
                    <View style={styles.listRow}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        accessibilityLabel={`Select ${title}`}
                        onPress={() => toggleSelection(item.key)}
                        hitSlop={6}
                        style={styles.checkHit}
                      >
                        <View
                          style={[
                            styles.checkCircle,
                            checked
                              ? { backgroundColor: c.primary, borderColor: c.primary }
                              : { borderColor: c.text2 },
                          ]}
                        >
                          {checked ? <Feather name="check" size={12} color={c.onPrimary} /> : null}
                        </View>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${title}, ${botName(item.profile)}`}
                        onPress={() => router.push({ pathname: '/bot/[profile]/record', params: { profile: item.profile, id: row.id } })}
                        style={({ pressed }) => [styles.listMain, pressed && { opacity: 0.65 }]}
                      >
                        <BotFace name={item.profile} meta={metas[item.profile]} size={28} />
                        <View style={styles.flex}>
                          <View style={styles.listTop}>
                            <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
                              {title}
                            </T>
                            {meta ? (
                              <T variant="meta" color={!row.signal && urgentMeta ? 'needsYouText' : 'text2'}>
                                {meta}
                              </T>
                            ) : null}
                          </View>
                          <T variant="secondary" color="text2" numberOfLines={1}>
                            {sub ? `${botName(item.profile)} · ${sub}` : `${botName(item.profile)} · ${item.record.view_title}`}
                          </T>
                        </View>
                      </Pressable>
                    </View>
                  </View>
                )
              }

              return (
                <View style={[radiusStyle, { backgroundColor: c.sheet }]}>
                  {index > 0 ? <View style={[styles.listSep, { backgroundColor: c.separator }]} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${cardName(item, context)}: ${cardLine(item)}`}
                    onPress={() => {
                      modeTouched.current = true
                      setSkipped(startAt(filtered, item.key))
                      setMode('deck')
                    }}
                    style={({ pressed }) => [styles.listRow, styles.blockedListRow, pressed && { backgroundColor: c.tone }]}
                  >
                    <AttentionDot size={8} />
                    {item.kind === 'room' ? (
                      <RoomFaces members={item.view.data.room.members.slice(0, 2)} metas={metas} variant="header" ring={c.sheet} />
                    ) : (
                      <BotFace name={item.profile} meta={metas[item.profile]} size={28} />
                    )}
                    <View style={styles.flex}>
                      <View style={styles.listTop}>
                        <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
                          {cardName(item, context)}
                        </T>
                        <T variant="meta" color="text2">
                          {cardAge(item, context)}
                        </T>
                      </View>
                      <T variant="secondary" numberOfLines={1}>
                        {cardLine(item)}
                      </T>
                    </View>
                    <Feather name="chevron-right" size={16} color={c.text2} />
                  </Pressable>
                </View>
              )
            }}
            ListEmptyComponent={
              <View style={styles.listEmpty}>
                <EmptyState
                  filtered={bucket !== 'all' || botFilter !== null || sourceFilter !== null}
                  onClear={() => {
                    setBucket('all')
                    setBotFilter(null)
                    setSourceFilter(null)
                  }}
                />
              </View>
            }
          />

          {selectedCards.length > 0 ? (
            <View style={styles.bulkDock}>
              <Raised radius={radius.tray} style={styles.bulkBar}>
                <Pill
                  label={`Done (${selectedCards.length})`}
                  variant="primary"
                  height={44}
                  flex
                  loading={bulkBusy}
                  onPress={() => void runBulkDone(selectedCards)}
                />
                <Pill
                  label={`Snooze (${selectedCards.length})`}
                  variant="secondary"
                  height={44}
                  flex
                  disabled={bulkBusy}
                  onPress={() => setBulkMuting(selectedCards)}
                />
              </Raised>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrolls}
          onLayout={event => {
            const view = event.nativeEvent.layout.height
            setFrame(current => (current.view === view ? current : { ...current, view }))
          }}
          onContentSizeChange={(_, content) => setFrame(current => (current.content === content ? current : { ...current, content }))}
        >
          <View style={styles.above} />
          {topEntry ? (
            <>
              <View style={[styles.deck, { paddingTop: behind * 30 }]}>
                {thirdEntry ? <BehindCard card={thirdEntry} context={context} depth={2} behind={behind} onPress={() => onTurn('next', 2)} /> : null}
                {nextEntry ? <BehindCard card={nextEntry} context={context} depth={1} behind={behind} onPress={() => onTurn('next')} /> : null}
                {/* Keyed by what is on top and how often the deck turned, so a card that comes round again arrives fresh. */}
                <SwipeCard
                  key={`${topEntry.key}#${turns}`}
                  sideways={sideways}
                  upDown={upDown}
                  returnLeft={isRecord}
                  onSwipe={direction => (topEntry.kind === 'stack' ? onTurn('next') : onSwipe(topEntry, direction))}
                  onTurn={way => onTurn(way)}
                >
                  {topEntry.kind === 'stack' ? (
                    <StackTopCard
                      stack={topEntry}
                      context={context}
                      onInspect={() => {
                        modeTouched.current = true
                        setBotFilter(topEntry.profile)
                        setMode('list')
                      }}
                      onDoneAll={() => void runBulkDone(topEntry.cards)}
                      onSnoozeAll={() => setBulkMuting(topEntry.cards)}
                      onTriage={() => void askBotToTriage({ profile: topEntry.profile, count: topEntry.cards.length, viewTitle: topEntry.viewTitle })}
                    />
                  ) : (
                    <TopCard card={topEntry} context={context} />
                  )}
                </SwipeCard>
              </View>
              {sideways ? (
                isRecord ? (
                  <View style={styles.hint} accessibilityLabel={`Swipe right when done, left to mute${upDown ? ', up for the next' : ''}`}>
                    <View style={styles.hintSide}>
                      <Feather name="arrow-left" size={16} color={c.text2} />
                      <T variant="label" color="text2">
                        Mute
                      </T>
                    </View>
                    {upDown ? (
                      <View style={styles.hintSide}>
                        <Feather name="arrow-up" size={16} color={c.text2} />
                        <T variant="label" color="text2">
                          Next
                        </T>
                      </View>
                    ) : null}
                    <View style={styles.hintSide}>
                      <T variant="label" color="text2">
                        Done
                      </T>
                      <Feather name="arrow-right" size={16} color={c.text2} />
                    </View>
                  </View>
                ) : (
                  <View style={[styles.hint, styles.hintCenter]}>
                    <T variant="label" color="text2">
                      {upDown ? 'Swipe up for the next one' : 'Swipe to look at it later'}
                    </T>
                  </View>
                )
              ) : null}
              {triageScope && topEntry.kind !== 'stack' ? (
                <View style={styles.deckTriage}>
                  <Pill
                    label={`Ask ${botName(triageScope.profile)} to triage`}
                    variant="secondary"
                    icon="message-circle"
                    height={36}
                    onPress={() => void askBotToTriage()}
                  />
                </View>
              ) : null}
            </>
          ) : (
            <EmptyState
              filtered={bucket !== 'all' || botFilter !== null || sourceFilter !== null}
              onClear={() => {
                setBucket('all')
                setBotFilter(null)
                setSourceFilter(null)
              }}
            />
          )}
          <View style={styles.below} />
        </ScrollView>
      )}

      <MuteSheet
        title={
          bulkMuting
            ? `${bulkMuting.length} selected ${bulkMuting.length === 1 ? 'item' : 'items'}`
            : muting
              ? muting.record.row.title
                ? formatTyped(muting.record.row.title, muting.nowS)
                : 'This record'
              : null
        }
        botName={bulkMuting ? bulkBotName : muting ? botName(muting.profile) : ''}
        count={bulkMuting ? bulkMuting.length : 1}
        pluralOwner={bulkMuting ? bulkProfiles.length > 1 : false}
        nowS={nowS}
        onClose={() => {
          setMuting(null)
          setBulkMuting(null)
        }}
        onPick={until => {
          if (bulkMuting) {
            const group = bulkMuting
            setBulkMuting(null)
            void runBulkMute(group, until)

            return
          }

          const target = muting
          setMuting(null)

          if (target) {
            void mute(target, until)
          }
        }}
      />
    </Screen>
  )
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme()

  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.primary : c.control }]}
    >
      <T variant="label" color={active ? 'onPrimary' : 'text'} style={styles.chipText}>
        {label}
      </T>
    </Press>
  )
}

function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <View style={styles.empty}>
      <T variant="heading">{filtered ? 'Nothing matches this filter' : 'Nothing needs you'}</T>
      <T variant="secondary" color="text2" style={styles.centered}>
        {filtered
          ? 'Switch filters or show all items waiting across your bots.'
          : 'When a bot needs an approval, an answer or a secret, or its dashboard holds something for you, it shows up here.'}
      </T>
      {filtered ? <Pill label="Show all" variant="secondary" height={40} onPress={onClear} style={styles.clearBtn} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  filterWrap: { paddingTop: 10, paddingBottom: 10 },
  filterRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  chip: { height: 34, borderRadius: radius.pill, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontFamily: fonts.medium },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  toolbarLeft: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  toolBtn: { height: 36, borderRadius: radius.pill, paddingHorizontal: 14, justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  listWithBar: { paddingBottom: 96 },
  listSep: { height: 1, marginLeft: 80 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 16, paddingLeft: 10, paddingVertical: 12, gap: 8 },
  blockedListRow: { paddingLeft: 16, gap: 10 },
  listMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  listTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  checkHit: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.8, alignItems: 'center', justifyContent: 'center' },
  listEmpty: { paddingTop: 64 },
  bulkDock: { position: 'absolute', left: 16, right: 16, bottom: 12 },
  bulkBar: { flexDirection: 'row', gap: 8, padding: 8 },
  scroll: { flexGrow: 1, paddingBottom: 24 },
  above: { flex: 1, minHeight: 4 },
  below: { flex: 1.2, minHeight: 12 },
  deck: { marginHorizontal: 16, zIndex: 1 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginHorizontal: 28 },
  hintCenter: { justifyContent: 'center' },
  hintSide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deckTriage: { alignItems: 'center', marginTop: 16 },
  empty: { alignItems: 'center', gap: 6, paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
  clearBtn: { marginTop: 8 },
})
