import Feather from '@expo/vector-icons/Feather'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { RestartRow } from '@/components/restart/RestartRow'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import type { SavedServerMeta } from '@/lib/hermes/servers'
import { openLink } from '@/lib/openLink'
import { useConnection } from '@/stores/connection'
import { usePhone } from '@/stores/phone'
import { usePrefs, type ThemePref } from '@/stores/prefs'
import { useRestart } from '@/stores/restart'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const STATUS = { unconfigured: 'Not connected', connecting: 'Connecting…', online: 'Connected', offline: 'Offline' } as const

const SITE = 'https://blobs.maddtechnologies.com'
const PRIVACY_URL = `${SITE}/privacy.html`
const SUPPORT_URL = 'https://github.com/Madd-Technologies/blobs/issues'
const SOURCE_URL = 'https://github.com/Madd-Technologies/blobs'

export default function Settings() {
  const router = useRouter()
  const baseUrl = useConnection(state => state.config?.baseUrl ?? '')
  const servers = useConnection(state => state.servers)
  const activeServerId = useConnection(state => state.activeServerId)
  const switchServer = useConnection(state => state.switchServer)
  const removeServer = useConnection(state => state.removeServer)
  const renameServer = useConnection(state => state.renameServer)
  const user = useConnection(state => (state.config?.auth.kind === 'oauth' ? (state.config.auth.user ?? 'you') : null))
  const status = useConnection(state => state.status)
  const restartPhase = useRestart(state => state.phase.kind)
  const lastError = useConnection(state => state.lastError)
  const forget = useConnection(state => state.forget)
  const theme = usePrefs(state => state.theme)
  const setTheme = usePrefs(state => state.setTheme)
  const showThinking = usePrefs(state => state.showThinking)
  const setShowThinking = usePrefs(state => state.setShowThinking)
  const showBotChatter = usePrefs(state => state.showBotChatter)
  const setShowBotChatter = usePrefs(state => state.setShowBotChatter)
  const phone = usePhone(state => state.available)
  const [pickTheme, setPickTheme] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [menuServer, setMenuServer] = useState<SavedServerMeta | null>(null)
  const [renaming, setRenaming] = useState<SavedServerMeta | null>(null)
  const [renameText, setRenameText] = useState('')
  const [removing, setRemoving] = useState<SavedServerMeta | null>(null)
  const { c } = useTheme()
  const host = baseUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')

  async function selectServer(server: SavedServerMeta) {
    if (server.id === activeServerId) {
      return
    }

    const error = await switchServer(server.id)

    if (error) {
      toast(error)
    } else {
      toast(`Switched to ${server.label}`)
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.body}>
        <GroupedList separators={false}>
          <View style={styles.server} accessible accessibilityLabel={`${host}. ${STATUS[status]}${user ? `, signed in as ${user}` : ''}`}>
            <View style={[styles.serverIcon, { backgroundColor: c.control }]}>
              <Feather name="server" size={18} color={c.text2} />
              <View style={[styles.serverDot, { backgroundColor: status === 'online' ? c.connected : status === 'offline' ? c.danger : c.text2, borderColor: c.sheet }]} />
            </View>
            <View style={styles.serverText}>
              <T variant="rowTitle" numberOfLines={1}>
                {host}
              </T>
              <T variant="label" color="text2" numberOfLines={1}>
                {STATUS[status]}
                {user ? ` · signed in as ${user}` : ''}
              </T>
            </View>
          </View>
          <Row label="Server plugins" onPress={() => router.push('/plugins')} />
          {phone ? <Row label="Phone" onPress={() => router.push('/phone')} /> : null}
          {status === 'online' || restartPhase === 'restarting' ? <RestartRow /> : null}
        </GroupedList>
        {status === 'offline' && lastError ? (
          <T variant="label" color="text2" style={styles.error}>
            {lastError}
          </T>
        ) : null}

        <GroupedList>
          {servers.map(server => {
            const active = server.id === activeServerId
            const serverHost = server.baseUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')

            return (
              <Pressable
                key={server.id}
                accessibilityRole="button"
                accessibilityLabel={`${server.label}, ${serverHost}${active ? ', active' : ''}`}
                onPress={() => void selectServer(server)}
                onLongPress={() => setMenuServer(server)}
                style={({ pressed }) => [styles.savedRow, { backgroundColor: pressed ? c.tone : 'transparent' }]}
              >
                <View style={[styles.savedDot, { backgroundColor: active ? (status === 'online' ? c.connected : status === 'offline' ? c.danger : c.text2) : c.control }]} />
                <View style={styles.serverText}>
                  <T variant="rowTitle" numberOfLines={1}>
                    {server.label}
                  </T>
                  <T variant="label" color="text2" numberOfLines={1}>
                    {serverHost}
                    {server.user ? ` · ${server.user}` : ''}
                  </T>
                </View>
                {active ? (
                  <T variant="label" color="text2">
                    Active
                  </T>
                ) : null}
                <IconCircle icon="more-horizontal" label={`Options for ${server.label}`} bare diameter={32} onPress={() => setMenuServer(server)} />
              </Pressable>
            )
          })}
          <Row label="Add server" onPress={() => router.push('/server-add')} />
        </GroupedList>

        <GroupedList separators={false}>
          <Row label="Theme" value={THEMES.find(option => option.value === theme)?.label} onPress={() => setPickTheme(true)} />
          <Row label="Show thinking" right={<Switch value={showThinking} onValueChange={setShowThinking} label="Show thinking" />} />
          <Row label="Show messages between bots" right={<Switch value={showBotChatter} onValueChange={setShowBotChatter} label="Show messages between bots" />} />
          {Platform.OS === 'android' ? <Row label="Notifications" onPress={() => router.push('/notifications')} /> : null}
        </GroupedList>

        <GroupedList separators={false}>
          <Row label="How Blobs works" onPress={() => router.push('/tour')} />
          <Row label="Privacy" onPress={() => void openLink(PRIVACY_URL)} />
          <Row label="Support" onPress={() => void openLink(SUPPORT_URL)} />
          <Row label="Source" onPress={() => void openLink(SOURCE_URL)} />
          <Row label="Licences" onPress={() => router.push('/licences')} />
        </GroupedList>

        {__DEV__ ? (
          <GroupedList separators={false}>
            <Row label="Design gallery" onPress={() => router.push('/dev/gallery')} />
          </GroupedList>
        ) : null}

        <GroupedList separators={false}>
          <Row label={user ? 'Sign out' : 'Disconnect'} destructive onPress={() => setConfirm(true)} />
        </GroupedList>

        <T variant="meta" color="text2" style={styles.version}>
          Blobs {Constants.expoConfig?.version ?? ''}
        </T>
      </ScrollView>

      <Sheet visible={pickTheme} onClose={() => setPickTheme(false)} label="Theme">
        <GroupedList>
          {THEMES.map(option => (
            <Row
              key={option.value}
              label={option.label}
              chevron={false}
              value={option.value === theme ? 'Selected' : undefined}
              onPress={() => {
                setTheme(option.value)
                setPickTheme(false)
              }}
            />
          ))}
        </GroupedList>
      </Sheet>

      <Sheet visible={!!menuServer} onClose={() => setMenuServer(null)} label="Server options">
        {menuServer ? (
          <GroupedList>
            {menuServer.id !== activeServerId ? (
              <Row
                label="Switch to this server"
                onPress={() => {
                  const chosen = menuServer
                  setMenuServer(null)
                  void selectServer(chosen)
                }}
              />
            ) : null}
            <Row
              label="Rename"
              onPress={() => {
                setRenaming(menuServer)
                setRenameText(menuServer.label)
                setMenuServer(null)
              }}
            />
            <Row
              label="Remove server"
              destructive
              chevron={false}
              onPress={() => {
                setRemoving(menuServer)
                setMenuServer(null)
              }}
            />
          </GroupedList>
        ) : null}
      </Sheet>

      <Sheet visible={!!renaming} onClose={() => setRenaming(null)} label="Rename server" avoidKeyboard>
        {renaming ? (
          <View style={styles.renameSheet}>
            <T variant="sheetTitle">Rename server</T>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Server name"
              placeholderTextColor={c.text2}
              autoFocus
              returnKeyType="done"
              style={[styles.renameField, { backgroundColor: c.tone, color: c.text }]}
              onSubmitEditing={() => {
                if (renameText.trim()) {
                  void renameServer(renaming.id, renameText)
                  setRenaming(null)
                }
              }}
            />
            <Pill
              label="Save"
              variant="primary"
              height={48}
              disabled={!renameText.trim()}
              onPress={() => {
                void renameServer(renaming.id, renameText)
                setRenaming(null)
              }}
            />
          </View>
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={!!removing}
        title={`Remove ${removing?.label ?? 'server'}?`}
        message={
          removing?.id === activeServerId && servers.length > 1
            ? 'Blobs will switch to your next saved server.'
            : 'Saved credentials for this server will be deleted from this phone.'
        }
        confirmLabel="Remove"
        destructive
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) {
            void removeServer(removing.id)
          }
        }}
      />

      <ConfirmSheet
        visible={confirm}
        title={user ? 'Sign out of this server?' : 'Disconnect from this server?'}
        message={
          servers.length > 1
            ? 'This server will be removed and Blobs will switch to another saved server.'
            : user
              ? 'You will need your password to sign in again.'
              : 'You can connect again with the session token.'
        }
        confirmLabel={user ? 'Sign out' : 'Disconnect'}
        destructive
        onClose={() => setConfirm(false)}
        onConfirm={() => void forget()}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 32, gap: 16 },
  server: { minHeight: 72, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  serverIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  serverDot: { position: 'absolute', right: 1, bottom: 1, width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  serverText: { flex: 1, minWidth: 0, gap: 2 },
  savedRow: { minHeight: 56, paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  savedDot: { width: 9, height: 9, borderRadius: 5 },
  renameSheet: { gap: 14 },
  renameField: { height: 48, borderRadius: radius.field, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 15 },
  version: { textAlign: 'center', paddingTop: 4 },
  error: { paddingHorizontal: 4, marginTop: -8 },
})
