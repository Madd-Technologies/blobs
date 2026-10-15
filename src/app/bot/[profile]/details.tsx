import Feather from '@expo/vector-icons/Feather'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { AttentionDot } from '@/components/bots/AttentionDot'
import { BotPaper } from '@/components/bots/BotPaper'
import { TapFace } from '@/components/bots/TapFace'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill, type FeatherName } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Sheet } from '@/components/ui/Sheet'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Screen } from '@/components/ui/Screen'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { isDozing, motionFor } from '@/features/face/motion'
import { afterSheetCloses } from '@/lib/afterSheet'
import { toolsetsLine } from '@/lib/hermes/toolsets'
import { useToolsets } from '@/stores/toolsets'
import { APPROVAL_MODES, bareModel, chatModelDiffers, isProtectedProfile, uniqueSkills, type ApprovalMode } from '@/lib/hermes/profiles'
import { useBotView } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { useDashboards } from '@/stores/dashboards'
import { usePrefs } from '@/stores/prefs'
import { reloadEnv, removeBot, saveApprovalMode, saveBotMeta, useApprovals, useProfileDetail } from '@/stores/profiles'
import { useRoutines } from '@/stores/routines'
import { useBotSession, useChosenChat } from '@/stores/sessions'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { radius } from '@/theme/tokens'

/** A bot's details: who it is, how it looks, and what it can do. */
export default function BotDetails() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const router = useRouter()
  const dashboards = useDashboards(state => state.available === true)
  const needsYou = useDashboards(state => state.summary[profile]?.needs_you ?? 0)
  const view = useBotView(profile)
  // Opening this bot goes back to the side chat it was last on, instead of its main chat.
  const reopenLast = usePrefs(state => !!state.reopenLast[profile])
  const setReopenLast = usePrefs(state => state.setReopenLast)
  const online = useConnection(state => state.status === 'online')
  const detail = useProfileDetail(state => state.byBot[profile]?.detail ?? null)
  const chatInfoModel = useBotSession(profile)?.info?.model
  const chosen = useChosenChat(profile)
  // The model the open chat is really using, when it is not the bot's default (a /model switch, or the server's fallback).
  const chatModel = chatModelDiffers(detail?.model.default, chatInfoModel)
  const approvals = useApprovals(state => state.byBot[profile])
  const routineCount = useRoutines(state => state.byBot[profile]?.jobs?.length)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [choosingApprovals, setChoosingApprovals] = useState(false)
  const [confirmNever, setConfirmNever] = useState(false)
  const protectedBot = isProtectedProfile(profile)

  useEffect(() => {
    if (online) {
      void useProfileDetail.getState().load(profile)
      void useApprovals.getState().load(profile)
      void useRoutines.getState().load(profile)
      void useToolsets.getState().load(profile)
    }
  }, [online, profile])

  const skillList = useMemo(() => uniqueSkills(detail?.skills ?? []), [detail])
  const toolsets = useToolsets(state => state.byBot[profile])
  const toolsLine = toolsetsLine(toolsets?.rows ?? [])
  const skillsLine = detail ? `${skillList.filter(skill => skill.enabled).length} of ${skillList.length} on` : ''
  const name = view?.name ?? profile
  const description = detail?.description ?? view?.row.description ?? ''
  const edit = (field: 'title' | 'description' | 'soul') => {
    setEditing(false)
    afterSheetCloses(() => router.push({ pathname: '/bot/[profile]/edit', params: { profile, field } }))
  }

  async function toggle(key: 'pinned' | 'hidden', value: boolean) {
    const error = await saveBotMeta(profile, { [key]: value ? true : null })

    if (error) {
      toast(error)
    }
  }

  async function setApprovals(mode: ApprovalMode) {
    setChoosingApprovals(false)
    const error = await saveApprovalMode(profile, mode)

    if (error) {
      toast(error)
    }
  }

  async function reload() {
    const result = await reloadEnv()
    toast('error' in result ? result.error : result.updated ? `Reloaded ${result.updated} setting${result.updated === 1 ? '' : 's'}` : 'Nothing had changed')
  }

  async function remove() {
    const error = await removeBot(profile)

    if (error) {
      toast(error)

      return
    }

    router.dismissTo('/')
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <View style={styles.fill} />
          <Pill label="Edit" height={40} accessibilityLabel={`Edit ${name}`} onPress={() => setEditing(true)} />
        </View>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <TapFace name={profile} meta={view?.meta} size={88} motion={motionFor({ needsYou: view?.attention.state === 'needsYou', working: view?.attention.state === 'working', dozing: isDozing(view?.lastActive) })} />
            <T variant="title" style={[styles.centered, styles.name]} accessibilityRole="header">
              {name}
            </T>
            {description ? (
              <T variant="body" color="text2" style={styles.centered} numberOfLines={3}>
                {description}
              </T>
            ) : null}
          </View>

          {/* Where to go with this bot: its chat (the next thing to do, so the white one), its dashboard and its screen. */}
          <View style={styles.tiles}>
            <Tile icon="message-square" label="Chat" primary onPress={() => router.push({ pathname: '/bot/[profile]', params: { profile } })} />
            {dashboards ? (
              <Tile
                icon="layout"
                label="Dashboard"
                waiting={needsYou > 0}
                accessibilityLabel={needsYou ? `Dashboard, ${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you` : 'Dashboard'}
                onPress={() => router.push({ pathname: '/bot/[profile]/dashboard', params: { profile } })}
              />
            ) : null}
            <Tile icon="monitor" label="Screen" onPress={() => router.push({ pathname: '/screens/[profile]', params: { profile } })} />
          </View>

          <GroupedList radius={20}>
            <Row label="Model" value={detail?.model.default ?? ''} onPress={() => router.push({ pathname: '/bot/[profile]/model', params: { profile } })} />
            {chatModel ? <Row label={chosen ? 'This side chat' : 'Main chat now'} value={chatModel} /> : null}
            <Row
              label="Skills"
              value={skillsLine}
              onPress={() => router.push({ pathname: '/bot/[profile]/skills', params: { profile } })}
            />
            <Row label="Tools" value={toolsLine} onPress={() => router.push({ pathname: '/bot/[profile]/tools', params: { profile } })} />
            <Row label="Routines" value={routineCount === undefined ? '' : String(routineCount)} onPress={() => router.push({ pathname: '/bot/[profile]/routines', params: { profile } })} />
            <Row label="Approvals" value={approvals ? APPROVAL_MODES.find(mode => mode.value === approvals)?.label : ''} onPress={() => setChoosingApprovals(true)} />
          </GroupedList>
          {chatModel ? (
            <T variant="label" color="text2" style={styles.note}>
              {chosen ? 'This side chat' : `${name}’s main chat`} is answering with {chatModel}, not {bareModel(detail?.model.default ?? '')}. The server switches a chat to its fallback model when the default one fails (out of credit or rate limited) and tries the default again later; a /model in that chat also does this.
            </T>
          ) : null}

          <GroupedList radius={20}>
            <Row label="Pin to top" right={<Switch value={!!view?.pinned} onValueChange={value => void toggle('pinned', value)} label="Pin to top" />} />
            <Row label="Hide from list" right={<Switch value={!!view?.meta?.hidden} onValueChange={value => void toggle('hidden', value)} label="Hide from list" />} />
            <Row label="Open last side chat" right={<Switch value={reopenLast} onValueChange={on => setReopenLast(profile, on)} label="Open last side chat" />} />
          </GroupedList>

          <GroupedList radius={20}>
            <Row label="Reload settings" chevron={false} onPress={() => void reload()} />
          </GroupedList>
          <T variant="label" color="text2" style={styles.note}>
            Skills, tools and instructions reach {name}’s main chat on its next message. Reload settings re-reads the server’s .env, so new keys work without a restart.
          </T>

          {protectedBot ? null : (
            <GroupedList radius={20}>
              <Row label="Delete bot" destructive onPress={() => setConfirmDelete(true)} />
            </GroupedList>
          )}

          <T variant="meta" color="text2" style={styles.slug}>
            Profile name: {profile}
          </T>
        </ScrollView>

        <Sheet visible={editing} onClose={() => setEditing(false)} label={`Edit ${name}`}>
          <GroupedList>
            <Row label="Name" value={name} onPress={() => edit('title')} />
            <Row label="Description" value={description || 'None'} onPress={() => edit('description')} />
            <Row label="Instructions" value={detail ? (detail.soul.trim() ? 'Set' : 'None') : ''} onPress={() => edit('soul')} />
            <Row
              label="Look"
              onPress={() => {
                setEditing(false)
                afterSheetCloses(() => router.push({ pathname: '/bot/[profile]/look', params: { profile } }))
              }}
            />
          </GroupedList>
        </Sheet>

        <Sheet visible={choosingApprovals} onClose={() => setChoosingApprovals(false)} label="Approvals">
          <GroupedList>
            {APPROVAL_MODES.map(mode => (
              <Row
                key={mode.value}
                label={mode.label}
                value={mode.value === approvals ? 'Selected' : undefined}
                chevron={false}
                onPress={() => (mode.value === 'off' ? (setChoosingApprovals(false), afterSheetCloses(() => setConfirmNever(true))) : void setApprovals(mode.value))}
              />
            ))}
          </GroupedList>
          <T variant="label" color="text2" style={styles.hints}>
            {APPROVAL_MODES.map(mode => `${mode.label}: ${mode.hint}`).join('\n')}
          </T>
        </Sheet>

        <ConfirmSheet
          visible={confirmNever}
          title={`Stop asking before ${name} runs risky commands?`}
          message="It will delete files, run installers and change settings without waiting for you. You can switch this back at any time."
          confirmLabel="Never ask"
          destructive
          onClose={() => setConfirmNever(false)}
          onConfirm={() => void setApprovals('off')}
        />

        <ConfirmSheet
          visible={confirmDelete}
          title={`Delete ${name}?`}
          message="Its chats, instructions and settings are removed from the server. This can’t be undone."
          confirmLabel="Delete bot"
          destructive
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      </Screen>
    </BotPaper>
  )
}

/** A place to go from a bot's details: an icon over its name on a tile. The chat's tile is the white one. */
function Tile({ icon, label, primary, waiting, accessibilityLabel, onPress }: { icon: FeatherName; label: string; primary?: boolean; waiting?: boolean; accessibilityLabel?: string; onPress: () => void }) {
  const { c } = useTheme()
  const fg = primary ? c.onPrimary : c.text

  return (
    <Press accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} style={[styles.tile, { backgroundColor: primary ? c.primary : c.control }]}>
      <View style={styles.tileTop}>
        <Feather name={icon} size={20} color={fg} />
        {waiting ? <AttentionDot size={8} style={styles.tileDot} /> : null}
      </View>
      <T variant="rowTitle" color={fg} numberOfLines={1}>
        {label}
      </T>
    </Press>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: 16, paddingTop: 8 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  hero: { alignItems: 'center', gap: 4, paddingTop: 2, paddingBottom: 10, paddingHorizontal: 20 },
  name: { marginTop: 6 },
  tiles: { flexDirection: 'row', gap: 10, paddingBottom: 4 },
  tile: { flex: 1, height: 76, borderRadius: radius.chip, paddingVertical: 12, paddingHorizontal: 14, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileDot: { marginTop: 2 },
  centered: { textAlign: 'center' },
  slug: { textAlign: 'center', paddingTop: 4 },
  note: { paddingHorizontal: 8, textAlign: 'center' },
  hints: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
})
