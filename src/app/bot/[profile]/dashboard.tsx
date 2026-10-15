import Feather from '@expo/vector-icons/Feather'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { PanelMenu } from '@/components/dashboard/PanelMenu'
import { useRowActions } from '@/components/dashboard/useRowActions'
import { NumbersBlock, ViewBlock } from '@/components/dashboard/ViewBlock'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { T } from '@/components/ui/T'
import { isDozing, motionFor } from '@/features/face/motion'
import { askAboutPanel, groupNumbers, updatedLine } from '@/features/dashboard/view'
import { installMessage } from '@/features/plugins/catalog'
import type { View as DashboardView } from '@/lib/hermes/dashboard'
import { useNow } from '@/lib/useNow'
import { useBotView, useFaceColor } from '@/stores/bots'
import { startDashboardPoll, useBotBoard, useDashboards } from '@/stores/dashboards'
import { useDrafts } from '@/stores/drafts'
import { toast } from '@/stores/toast'
import { BotTint, useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/**
 * What the empty dashboard offers to put in the chat's box. It names the skill and the tools: a bot's long-lived main chat
 * never gets the plugin's prompt line (Hermes adds plugin prompt sections to new chats only), plugin tools sit behind
 * Hermes's tool search, and "dashboard" alone reads as Hermes's own web dashboard (a bot asked for one may set out to build a plugin).
 */
const SET_UP =
  'Load skill_view("hermes-dashboard:dashboard") and use your dashboard_* tools (find them with tool search) to track something for me on my HermesBot app dashboard: a collection with its own fields, kept fresh by a routine. No new plugin. What to track: '

/** A pinned bot's dashboard: panels over the collections it keeps for you, with the chat one tap away. */
export default function BotDashboard() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const { c } = useTheme()
  const view = useBotView(profile)
  const tint = useFaceColor(profile)
  const board = useBotBoard(profile)
  const available = useDashboards(state => state.available)
  const checking = useDashboards(state => !!state.checking[profile])
  const [pulling, setPulling] = useState(false)
  const [menu, setMenu] = useState<DashboardView | null>(null)
  const clock = useNow(60)
  const name = view?.name ?? profile
  const working = view?.attention.state === 'working'
  const views = board.dashboard?.views ?? []
  const nowS = board.dashboard?.now || clock

  const rows = useRowActions(nowS, () => name)

  useEffect(() => startDashboardPoll(profile), [profile])
  useEffect(() => {
    useDashboards
      .getState()
      .loadKeepers(profile)
      .catch(() => undefined)
  }, [profile])

  const openChat = (draft?: string) => {
    if (draft) {
      useDrafts.getState().set(profile, draft)
    }

    router.push({ pathname: '/bot/[profile]', params: { profile } })
  }

  const openDetails = () => router.push({ pathname: '/bot/[profile]/details', params: { profile } })
  const openRecord = (id: string) => router.push({ pathname: '/bot/[profile]/record', params: { profile, id } })
  const openFull = (target: DashboardView) => router.push({ pathname: '/bot/[profile]/view', params: { profile, id: target.id } })

  async function onPull() {
    setPulling(true)
    await useDashboards.getState().load(profile)
    setPulling(false)
  }

  async function checkNow(panel: DashboardView) {
    setMenu(null)
    const result = await useDashboards.getState().checkPanel(profile, panel)

    if ('error' in result) {
      toast(`Couldn’t check: ${result.error}`)
    } else if (result.started === 0) {
      toast(`No routine keeps this dashboard yet. Ask ${name} to check on a schedule.`)
    }
  }


  const status = checking ? 'Checking…' : working ? 'Working…' : updatedLine(views, nowS)
  // One raised panel per dashboard: the first that holds something for you.
  const raisedPanel = views.find(panel => panel.kind !== 'number' && (panel.needs_you ?? 0) > 0)?.id

  return (
    <BotTint color={tint}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Press scale={0.98} accessibilityRole="button" accessibilityLabel={`${name}'s details`} onPress={openDetails} style={styles.identity}>
            <BotFace name={profile} meta={view?.meta} size={30} mood={working ? 'work' : 'idle'} motion={motionFor({ needsYou: view?.attention.state === 'needsYou', working, dozing: isDozing(view?.lastActive) })} />
            <View style={styles.flex}>
              <T variant="heading" numberOfLines={1}>
                {name}
              </T>
              {status ? (
                <T variant="status" color="text2" numberOfLines={1}>
                  {status}
                </T>
              ) : null}
            </View>
          </Press>
          <IconCircle icon="more-horizontal" label={`${name}'s details`} onPress={openDetails} />
        </View>

        <ScrollView style={styles.flex} contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={c.text2} />}>
          {groupNumbers(views).map(entry =>
            Array.isArray(entry) ? (
              <NumbersBlock key={entry.map(item => item.id).join('+')} views={entry} onMenu={setMenu} />
            ) : (
              <ViewBlock key={entry.id} view={entry} nowS={nowS} raised={entry.id === raisedPanel} onOpenRecord={openRecord} onToggle={(id, done) => rows.toggle(profile, id, done)} onMute={entry.collection ? row => rows.mute(profile, row) : undefined} onMenu={() => setMenu(entry)} onOpenFull={() => openFull(entry)} />
            ),
          )}

          {board.loaded && views.length === 0 ? (
            board.old ? (
              <View style={styles.empty}>
                <T variant="heading">Dashboards need an update</T>
                <T variant="secondary" color="text2" style={styles.centered}>
                  {board.error}
                </T>
                <Pill label="Server plugins" variant="primary" height={42} onPress={() => router.push('/plugins')} />
              </View>
            ) : available === false ? (
              <View style={styles.empty}>
                <BotFace name={profile} meta={view?.meta} size={64} mood="idle" />
                <T variant="heading">Dashboards aren’t on your server</T>
                <T variant="secondary" color="text2" style={styles.centered}>
                  They come with the optional Dashboards plugin. Your Hermes bot can install it for you.
                </T>
                <Pill label="Server plugins" variant="primary" height={42} onPress={() => router.push('/plugins')} />
              </View>
            ) : board.error ? (
              <T variant="secondary" color="text2" style={styles.centered}>
                Couldn’t load {name}’s dashboard: {board.error}
              </T>
            ) : board.dashboard?.installed === false ? (
              // Hermes loads plugins per bot: without its own copy this bot has no dashboard tools, so setting up a panel can't work.
              <View style={styles.empty}>
                <BotFace name={profile} meta={view?.meta} size={64} mood="idle" />
                <T variant="heading" style={styles.centered}>
                  {name} can’t keep a dashboard yet
                </T>
                <T variant="secondary" color="text2" style={styles.centered}>
                  Dashboards are on your server, but {name} doesn’t have the plugin. Your Hermes bot can add it for {name}, then restart Hermes.
                </T>
                <Pill
                  label="Copy install message"
                  variant="primary"
                  height={42}
                  onPress={() => {
                    void Clipboard.setStringAsync(installMessage(['hermes-dashboard'], undefined, [profile]))
                    toast('Copied. Paste it to your Hermes bot, then restart Hermes when it’s done.')
                  }}
                />
              </View>
            ) : (
              <View style={styles.empty}>
                <BotFace name={profile} meta={view?.meta} size={64} mood="idle" />
                <T variant="heading">Nothing here yet</T>
                <T variant="secondary" color="text2" style={styles.centered}>
                  {name} can track things for you here: what it found, things to follow up, reminders, numbers over time. Tell it what to track and how often to check.
                </T>
                <Pill label="Set up a panel" variant="primary" height={42} onPress={() => openChat(SET_UP)} />
              </View>
            )
          ) : null}
        </ScrollView>

        {/* The chat's tray, a tap away: it opens the chat to write in. */}
        <View style={styles.footer}>
          <Press accessibilityRole="button" accessibilityLabel={`Message ${name}`} onPress={() => openChat()} scale={0.98}>
            <Raised radius={radius.tray} style={styles.tray}>
              <View style={[styles.trayButton, { backgroundColor: c.pressedIn }]}>
                <Feather name="plus" size={20} color={c.text} />
              </View>
              <T variant="body" color="text2" numberOfLines={1} style={styles.trayText}>
                Message {name}
              </T>
              <View style={[styles.trayButton, { backgroundColor: c.pressedIn }]}>
                <Feather name="mic" size={20} color={c.text} />
              </View>
            </Raised>
          </Press>
        </View>

        {rows.sheet}

        <PanelMenu
          view={menu}
          profile={profile}
          botName={name}
          onClose={() => setMenu(null)}
          onAsk={target => {
            setMenu(null)
            openChat(askAboutPanel(target))
          }}
          onCheck={panel => void checkNow(panel)}
          onOpenFull={target => {
            setMenu(null)
            openFull(target)
          }}
        />
      </Screen>
    </BotTint>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  identity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 64, paddingHorizontal: 24 },
  centered: { textAlign: 'center' },
  footer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  tray: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  trayButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  trayText: { flex: 1, paddingHorizontal: 10, fontSize: 16 },
})
