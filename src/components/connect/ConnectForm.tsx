import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { canScanQr, QrScannerSheet } from '@/components/connect/QrScannerSheet'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { T } from '@/components/ui/T'
import type { ParsedConnectQr } from '@/features/connect/qr'
import { authDeps } from '@/lib/auth-native'
import { signInWithPassword, SignInError } from '@/lib/hermes/auth'
import { normalizeBaseUrl, plainOverInternet, probeServer } from '@/lib/hermes/server'
import { serverKey } from '@/lib/hermes/servers'
import { secure } from '@/lib/secure'
import { useConnection } from '@/stores/connection'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** In development the simulator reaches the dev server on its own loopback. */
const DEFAULT_URL = __DEV__ ? 'http://127.0.0.1:9119' : ''
/** Optional build-time demo gateway for reviewers and first-time visitors trying Blobs without a server yet. */
const DEMO_URL = process.env.EXPO_PUBLIC_DEMO_URL?.trim() ?? ''

const safeHttpUrl = (candidate: string | undefined): string => {
  const value = candidate?.trim() ?? ''

  return /^https?:\/\//i.test(value) ? value : ''
}

function signInMessage(error: unknown, baseUrl: string): string {
  if (!(error instanceof SignInError)) {
    return 'Signing in failed. Try again.'
  }

  switch (error.kind) {
    case 'unreachable':
      return `Lost contact with ${baseUrl} while signing in. Try again.`
    case 'unsupported':
      return 'This server has no username and password sign-in. The app does not support its other sign-in options yet.'
    default:
      return error.message
  }
}

interface Props {
  mode: 'initial' | 'add'
  onDone?: () => void
}

export function ConnectForm({ mode, onDone }: Props) {
  const { c } = useTheme()
  const router = useRouter()
  const saveConfig = useConnection(state => state.saveConfig)
  const signedOut = useConnection(state => state.signedOut)
  const { url: linked } = useLocalSearchParams<{ url?: string }>()
  const linkedUrl = mode === 'initial' ? safeHttpUrl(linked) : ''
  const [url, setUrl] = useState(mode === 'initial' ? (signedOut?.baseUrl ?? (linkedUrl || DEFAULT_URL)) : '')
  const [label, setLabel] = useState('')
  const [prefilled, setPrefilled] = useState(linkedUrl)

  if (mode === 'initial' && linkedUrl && linkedUrl !== prefilled) {
    setPrefilled(linkedUrl)
    setUrl(linkedUrl)
  }

  const [token, setToken] = useState('')
  const [username, setUsername] = useState(mode === 'initial' ? (signedOut?.user ?? '') : '')
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(mode === 'initial' && signedOut !== null)
  const [busy, setBusy] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(mode === 'initial' ? (signedOut?.reason ?? null) : null)

  const field = [styles.field, { backgroundColor: c.sheet, color: c.text }]
  const showScan = canScanQr()
  const canSubmit = !busy && !!url.trim() && (usePassword ? !!username.trim() && !!password : !!token.trim())

  function handleScanned(parsed: ParsedConnectQr) {
    setUrl(parsed.url)
    setError(null)
    setNotice(null)

    if (parsed.label) {
      setLabel(parsed.label)
    }

    if (parsed.token) {
      setToken(parsed.token)
      setUsePassword(false)
    }
  }

  async function connect(overrideUrl?: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    const baseUrl = normalizeBaseUrl(overrideUrl ?? url)
    const probe = await probeServer(baseUrl)

    if (probe.apiServer) {
      setBusy(false)
      setError('That is Hermes’s API server (usually port 8642), which is a different service. Blobs connects to the dashboard gateway, usually port 9119.')

      return
    }

    if (!probe.ok) {
      setBusy(false)
      setError(
        probe.error?.startsWith('HTTP ')
          ? `${baseUrl} answered with ${probe.error}, so it is not a Hermes dashboard gateway. Check the port (usually 9119).`
          : `Can’t reach ${baseUrl}. Is Hermes running, and is this phone on the same network or Tailscale?`,
      )

      return
    }

    if (probe.authRequired && !usePassword) {
      setBusy(false)
      setUsePassword(true)
      setNotice('This server asks you to sign in with a username and password.')

      return
    }

    if (!probe.authRequired && usePassword) {
      setBusy(false)
      setError('This server does not use a username and password. Switch to its session token.')

      return
    }

    // Snapshot current active server when adding a server so failed auth rolls back without disturbing the current session.
    const prev = useConnection.getState()
    const snapshot = mode === 'add' ? { config: prev.config, serverId: prev.activeServerId, servers: prev.servers } : null

    if (usePassword) {
      try {
        const auth = await signInWithPassword({ baseUrl, username: username.trim(), password }, authDeps)
        setPassword('')
        await saveConfig({ baseUrl, auth }, label || undefined)
      } catch (signInError) {
        setBusy(false)
        setError(signInMessage(signInError, baseUrl))

        return
      }
    } else {
      await saveConfig({ baseUrl, auth: { kind: 'token', token: token.trim() } }, label || undefined)
    }

    const { status, lastError, activeServerId } = useConnection.getState()

    if (status !== 'online') {
      if (snapshot) {
        if (activeServerId && activeServerId !== snapshot.serverId) {
          await secure.remove(serverKey(activeServerId)).catch(() => undefined)
        }

        await useConnection.getState().restoreSnapshot(snapshot.config, snapshot.serverId, snapshot.servers)
      } else {
        await useConnection.getState().forget()
      }

      setBusy(false)
      setError(lastError ?? 'The server answered, but refused the connection. Check the session token.')

      return
    }

    setBusy(false)
    onDone?.()
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {mode === 'add' ? <ScreenHeader title="Add server" subtitle="Switch between multiple Hermes gateways." /> : null}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={[styles.body, mode === 'add' && styles.addBody]} keyboardShouldPersistTaps="handled">
          {mode === 'initial' ? (
            <>
              <BotFace name="hermes" meta={{ shape: 'circle', color: c.text }} size={56} />
              <T variant="title" style={styles.title}>
                Connect to Hermes
              </T>
              <T variant="body" color="text2" style={styles.lead}>
                {usePassword ? 'Sign in to the Hermes server that runs your bots.' : 'Paste your server’s session token to reach the bots it runs.'}
              </T>
            </>
          ) : null}

          <View style={styles.form}>
            {mode === 'add' || label ? (
              <View style={styles.label}>
                <T variant="label" color="text2">
                  Name (optional)
                </T>
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Home server, Work, Studio…"
                  placeholderTextColor={c.text2}
                  accessibilityLabel="Server name"
                  style={field}
                />
              </View>
            ) : null}

            <View style={styles.label}>
              <T variant="label" color="text2">
                Server
              </T>
              <View style={styles.urlRow}>
                <TextInput
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://hermes.your-tailnet.ts.net"
                  placeholderTextColor={c.text2}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  accessibilityLabel="Server address"
                  style={[field, styles.urlInput, { fontFamily: fonts.mono, fontSize: 14 }]}
                />
                {showScan ? <IconCircle icon="camera" label="Scan QR code" diameter={44} onPress={() => setScanOpen(true)} /> : null}
              </View>
              {url.trim() && plainOverInternet(url) ? (
                <T variant="meta" color="text2">
                  This address isn’t encrypted, so your sign-in and chats cross the internet in the clear. Use https, or reach the server over Tailscale or your own network.
                </T>
              ) : null}
            </View>

            {usePassword ? (
              <>
                <View style={styles.label}>
                  <T variant="label" color="text2">
                    Username
                  </T>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder="Username"
                    placeholderTextColor={c.text2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    returnKeyType="next"
                    accessibilityLabel="Username"
                    style={field}
                  />
                </View>
                <View style={styles.label}>
                  <T variant="label" color="text2">
                    Password
                  </T>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor={c.text2}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={() => canSubmit && void connect()}
                    accessibilityLabel="Password"
                    style={field}
                  />
                </View>
              </>
            ) : (
              <View style={styles.label}>
                <T variant="label" color="text2">
                  Session token
                </T>
                <TextInput
                  value={token}
                  onChangeText={setToken}
                  placeholder="Session token"
                  placeholderTextColor={c.text2}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="oneTimeCode"
                  accessibilityLabel="Session token"
                  style={[field, { fontFamily: fonts.mono, fontSize: 14 }]}
                />
              </View>
            )}

            {notice ? (
              <T variant="secondary" color="text2" accessibilityLiveRegion="polite">
                {notice}
              </T>
            ) : null}

            {error ? (
              <T variant="secondary" color="danger" accessibilityLiveRegion="polite">
                {error}
              </T>
            ) : null}

            <Pill label={usePassword ? 'Sign in' : 'Connect'} variant="primary" height={52} loading={busy} disabled={!canSubmit} onPress={() => void connect()} style={styles.primary} />
            {mode === 'initial' && DEMO_URL ? (
              <Pill
                label="Try live demo"
                variant="secondary"
                height={46}
                disabled={busy}
                onPress={() => {
                  setUrl(DEMO_URL)
                  void connect(DEMO_URL)
                }}
              />
            ) : null}
            <Pill
              label={usePassword ? 'Use a session token instead' : 'Use a username and password'}
              variant="ghost"
              onPress={() => {
                setUsePassword(!usePassword)
                setError(null)
                setNotice(null)
              }}
            />
          </View>

          {mode === 'initial' ? (
            <View style={styles.foot}>
              <T variant="label" color="text2" style={styles.center}>
                Connects straight to your server over your own network.
              </T>
              <Pill label="How Blobs works" variant="ghost" height={40} onPress={() => router.push('/tour')} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <QrScannerSheet visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={handleScanned} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 72 },
  addBody: { paddingTop: 22, paddingHorizontal: 16, paddingBottom: 32 },
  title: { marginTop: 24, marginBottom: 6 },
  lead: { marginBottom: 32 },
  form: { gap: 16 },
  label: { gap: 6 },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  urlInput: { flex: 1 },
  field: { height: 52, borderRadius: radius.field, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 15 },
  primary: { marginTop: 12 },
  foot: { marginTop: 'auto', paddingTop: 32, paddingBottom: 8, alignItems: 'center', gap: 4 },
  center: { textAlign: 'center' },
})
