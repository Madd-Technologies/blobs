import Feather from '@expo/vector-icons/Feather'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'

import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { useConnection } from '@/stores/connection'
import { usePrefs, type ThemePref } from '@/stores/prefs'
import { useTheme } from '@/theme/ThemeProvider'

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const STATUS = { unconfigured: 'Not connected', connecting: 'Connecting…', online: 'Connected', offline: 'Offline' } as const

export default function Settings() {
  const router = useRouter()
  const baseUrl = useConnection(state => state.config?.baseUrl ?? '')
  // Signed in with a password (rather than a session token): who, so the way out can say so.
  const user = useConnection(state => (state.config?.auth.kind === 'oauth' ? (state.config.auth.user ?? 'you') : null))
  const status = useConnection(state => state.status)
  const lastError = useConnection(state => state.lastError)
  const forget = useConnection(state => state.forget)
  const theme = usePrefs(state => state.theme)
  const setTheme = usePrefs(state => state.setTheme)
  const showThinking = usePrefs(state => state.showThinking)
  const setShowThinking = usePrefs(state => state.setShowThinking)
  const showBotChatter = usePrefs(state => state.showBotChatter)
  const setShowBotChatter = usePrefs(state => state.setShowBotChatter)
  const [pickTheme, setPickTheme] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const { c } = useTheme()
  const host = baseUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.body}>
        <GroupedList separators={false}>
          {/* The server: its address, and whether this phone is connected and signed in. */}
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
        </GroupedList>
        {status === 'offline' && lastError ? (
          <T variant="label" color="text2" style={styles.error}>
            {lastError}
          </T>
        ) : null}

        <GroupedList separators={false}>
          <Row label="Theme" value={THEMES.find(option => option.value === theme)?.label} onPress={() => setPickTheme(true)} />
          <Row label="Show thinking" right={<Switch value={showThinking} onValueChange={setShowThinking} label="Show thinking" />} />
          <Row label="Show messages between bots" right={<Switch value={showBotChatter} onValueChange={setShowBotChatter} label="Show messages between bots" />} />
          {Platform.OS === 'android' ? <Row label="Notifications" onPress={() => router.push('/notifications')} /> : null}
        </GroupedList>

        <GroupedList separators={false}>
          <Row label="How Blobs works" onPress={() => router.push('/tour')} />
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
          HermesBot {Constants.expoConfig?.version ?? ''}
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

      <ConfirmSheet
        visible={confirm}
        title={user ? 'Sign out of this server?' : 'Disconnect from this server?'}
        message={user ? 'You will need your password to sign in again.' : 'You can connect again with the session token.'}
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
  version: { textAlign: 'center', paddingTop: 4 },
  error: { paddingHorizontal: 4, marginTop: -8 },
})

