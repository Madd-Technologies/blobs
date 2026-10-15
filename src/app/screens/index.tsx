import { useIsFocused, useRouter } from 'expo-router'
import { useEffect, useMemo } from 'react'
import { Image, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotPaper } from '@/components/bots/BotPaper'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { BotView } from '@/features/roster/view'
import { faceColor } from '@/lib/hermes/faceColor'
import { startPoller } from '@/lib/poller'
import { useBotViews } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { display, useScreen } from '@/stores/display'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius, tintLevel } from '@/theme/tokens'

const GAP_X = 10
const PAD = 16

/** How often a running screen's picture is refreshed while this list is open. */
const THUMBNAIL_MS = 10_000

export default function Screens() {
  const router = useRouter()
  const views = useBotViews()
  const online = useConnection(state => state.status === 'online')
  const focused = useIsFocused()
  const { width } = useWindowDimensions()
  const tile = (width - PAD * 2 - GAP_X) / 2
  const profiles = useMemo(() => views.map(view => view.profile).join(','), [views])

  // Read every bot's screen when this opens, and again if the roster changes.
  useEffect(() => {
    if (online && focused && profiles) {
      void display.refreshAll(profiles.split(','))
    }
  }, [online, focused, profiles])

  // Keep the pictures of running screens fresh, only while this is on screen.
  useEffect(() => {
    if (!online || !focused || !profiles) {
      return
    }

    return startPoller(async () => {
      const running = profiles.split(',').filter(profile => display.get(profile).status?.running)
      await Promise.all(running.map(profile => display.thumbnail(profile)))
    }, THUMBNAIL_MS)
  }, [online, focused, profiles])

  const unsupported = views.length > 0 && views.every(view => display.get(view.profile).support === 'no')
  // The screen waiting for you (a bot that needs you, its screen running) rises above the rest, with Take over.
  const waiting = views.find(view => view.attention.state === 'needsYou' && display.get(view.profile).status?.running)
  const open = (profile: string) => router.push({ pathname: '/screens/[profile]', params: { profile } })

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Screens" subtitle={unsupported ? undefined : 'Each bot has its own desktop on your server.'} />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {unsupported ? (
          <View style={styles.empty}>
            <T variant="heading">Bot screens aren’t available</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              This Hermes server has no Bot Screen. It needs a newer Hermes on a Linux host.
            </T>
          </View>
        ) : (
          <>
            {waiting ? <Waiting view={waiting} onOpen={() => open(waiting.profile)} /> : null}
            <View style={styles.grid}>
              {views
                .filter(view => view.profile !== waiting?.profile)
                .map(view => (
                  <BotPaper key={view.profile} profile={view.profile}>
                    <Tile view={view} width={tile} onOpen={() => open(view.profile)} />
                  </BotPaper>
                ))}
            </View>
            <T variant="label" color="text2" style={styles.foot}>
              Open screens use memory on your server, about 220 MB each.{'\n'}Idle screens stop on their own.
            </T>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

/** What a screen shows on its card: the latest picture, a spinner while it comes, or the pill that starts it. */
function Picture({ view, radius: corner, onOpen }: { view: BotView; radius: number; /** Where setting up (or a screen that can't start here) goes. */ onOpen: () => void }) {
  const screen = useScreen(view.profile)
  const status = screen?.status
  const running = !!status?.running
  const driven = status?.lease.holder === 'human'

  if (running) {
    return (
      <View style={[styles.picture, { borderRadius: corner, backgroundColor: SCREEN_BACK }]}>
        {screen?.thumbnail ? (
          <Image source={{ uri: screen.thumbnail }} style={[styles.fill, driven && styles.dimmed]} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        )}
      </View>
    )
  }

  const starting = !status || screen?.busy === 'starting'

  return (
    <View style={[styles.picture, styles.center, { borderRadius: corner }]}>
      {starting ? (
        <Spinner size={16} />
      ) : (
        <Pill
          label={status.installed ? 'Start screen' : 'Set up screens'}
          icon={status.installed ? 'play' : 'download'}
          height={36}
          accessibilityLabel={status.installed ? `Start ${view.name}'s screen` : `Set up ${view.name}'s screen`}
          onPress={status.installed && !status.blocker ? () => void display.start(view.profile) : onOpen}
        />
      )}
    </View>
  )
}

/** The screen that is waiting for you: raised in its bot's paper, what it needs, and Take over as the white pill. */
function Waiting({ view, onOpen }: { view: BotView; onOpen: () => void }) {
  return (
    <BotPaper profile={view.profile}>
      <Press accessibilityRole="button" accessibilityLabel={`${view.name}'s screen. ${view.name} needs you`} onPress={onOpen} scale={0.98}>
        <Raised radius={22} style={styles.waiting}>
          <Picture view={view} radius={14} onOpen={onOpen} />
          <View style={styles.waitingName}>
            <T variant="rowTitle" numberOfLines={1} style={styles.flex}>
              {view.name}
            </T>
            <T variant="meta" color="text2">
              {view.age}
            </T>
          </View>
          <View style={styles.waitingLine}>
            <AttentionDot size={8} />
            <T variant="secondary" numberOfLines={2} style={[styles.flex, styles.medium]}>
              {view.preview || 'Waiting for you'}
            </T>
            <Pill label="Take over" variant="primary" height={36} onPress={onOpen} />
          </View>
        </Raised>
      </Press>
    </BotPaper>
  )
}

function Tile({ view, width, onOpen }: { view: BotView; width: number; onOpen: () => void }) {
  const { scheme } = useTheme()
  const screen = useScreen(view.profile)
  const status = screen?.status
  const running = !!status?.running
  const needsYou = view.attention.state === 'needsYou'
  const driven = status?.lease.holder === 'human'
  const state = driven ? 'In use' : running ? 'On' : status ? 'Off' : ''
  // A screen that is off starts from the pill on its card; the card itself opens the screen.
  const card = (
    <>
      <Picture view={view} radius={10} onOpen={onOpen} />
      <View style={styles.nameRow}>
        <T variant="secondary" numberOfLines={1} style={[styles.flex, styles.name]}>
          {view.name}
        </T>
        {needsYou ? (
          <AttentionDot size={8} />
        ) : (
          <T variant="meta" color="text2">
            {state}
          </T>
        )}
      </View>
    </>
  )
  const fill = { width, backgroundColor: tintLevel(scheme, 'pinned', faceColor(view.profile, view.meta)) }

  return running ? (
    <Press accessibilityRole="button" accessibilityLabel={`${view.name}'s screen${needsYou ? ', needs you' : ''}`} onPress={onOpen} style={[styles.tile, fill]}>
      {card}
    </Press>
  ) : (
    <View accessibilityLabel={`${view.name}'s screen, ${state.toLowerCase() || 'loading'}`} style={[styles.tile, fill]}>
      {card}
    </View>
  )
}

/** The dark of a screen behind its picture while it loads. */
const SCREEN_BACK = '#23262B'

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 32, gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP_X },
  waiting: { padding: 8 },
  waitingName: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, paddingHorizontal: 8, paddingBottom: 4 },
  waitingLine: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  medium: { fontFamily: fonts.medium },
  tile: { padding: 6, borderRadius: radius.list },
  picture: { aspectRatio: 16 / 10, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  dimmed: { opacity: 0.4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingHorizontal: 8, paddingBottom: 6 },
  name: { fontFamily: fonts.semibold, lineHeight: 18 },
  foot: { textAlign: 'center', paddingTop: 16, paddingHorizontal: 4 },
  empty: { alignItems: 'center', gap: 6, paddingTop: 80, paddingHorizontal: 16 },
  centered: { textAlign: 'center' },
})
