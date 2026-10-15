import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { T } from '@/components/ui/T'
import { authDeps } from '@/lib/auth-native'
import { signInWithPassword, SignInError } from '@/lib/hermes/auth'
import { normalizeBaseUrl, probeServer } from '@/lib/hermes/server'
import { useConnection } from '@/stores/connection'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** In development the simulator reaches the dev server on its own loopback. */
const DEFAULT_URL = __DEV__ ? 'http://127.0.0.1:9119' : ''

/** What to tell the user when signing in failed. The server's own wording is kept where it is already plain. */
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

export default function Connect() {
  const { c } = useTheme()
  const saveConfig = useConnection(state => state.saveConfig)
  // Set when a saved session ran out: come back to the same server, ready to sign in again.
  const signedOut = useConnection(state => state.signedOut)
  // Development only: `/connect?url=…` prefills the address, to point the simulator at a throwaway server. Never a token.
  const { url: linked } = useLocalSearchParams<{ url?: string }>()
  const [url, setUrl] = useState(signedOut?.baseUrl ?? ((__DEV__ && linked) || DEFAULT_URL))
  const [prefilled, setPrefilled] = useState(linked)

  if (__DEV__ && linked && linked !== prefilled) {
    setPrefilled(linked)
    setUrl(linked)
  }
  const [token, setToken] = useState('')
  const [username, setUsername] = useState(signedOut?.user ?? '')
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(signedOut !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(signedOut?.reason ?? null)

  const field = [styles.field, { backgroundColor: c.sheet, color: c.text }]
  const canSubmit = !busy && !!url.trim() && (usePassword ? !!username.trim() && !!password : !!token.trim())

  async function connect() {
    setBusy(true)
    setError(null)
    setNotice(null)
    const baseUrl = normalizeBaseUrl(url)
    const probe = await probeServer(baseUrl)

    if (probe.apiServer) {
      setBusy(false)
      setError('That is Hermes’s API server (usually port 8642), which is a different service. HermesBot connects to the dashboard gateway, usually port 9119.')

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
      // A gated server has no session token to paste: switch to the sign-in fields.
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

    if (usePassword) {
      try {
        const auth = await signInWithPassword({ baseUrl, username: username.trim(), password }, authDeps)
        setPassword('')
        await saveConfig({ baseUrl, auth })
      } catch (signInError) {
        setBusy(false)
        setError(signInMessage(signInError, baseUrl))

        return
      }
    } else {
      await saveConfig({ baseUrl, auth: { kind: 'token', token: token.trim() } })
    }

    const { status, lastError } = useConnection.getState()
    setBusy(false)

    if (status !== 'online') {
      setError(lastError ?? 'The server answered, but refused the connection. Check the session token.')
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BotFace name="hermes" meta={{ shape: 'circle', color: c.text }} size={56} />
          <T variant="title" style={styles.title}>
            Connect to Hermes
          </T>
          <T variant="body" color="text2" style={styles.lead}>
            {usePassword ? 'Sign in to the Hermes server that runs your bots.' : 'Paste your server’s session token to reach the bots it runs.'}
          </T>

          <View style={styles.form}>
            <View style={styles.label}>
              <T variant="label" color="text2">
                Server
              </T>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://hermes.your-tailnet.ts.net"
                placeholderTextColor={c.text2}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="Server address"
                style={[field, { fontFamily: fonts.mono, fontSize: 14 }]}
              />
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
                  // Not a password: stops iOS offering to save it to the keychain.
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

          <T variant="label" color="text2" style={styles.foot}>
            Connects straight to your server over your own network.
          </T>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 72 },
  title: { marginTop: 24, marginBottom: 6 },
  lead: { marginBottom: 32 },
  form: { gap: 16 },
  label: { gap: 6 },
  field: { height: 52, borderRadius: radius.field, paddingHorizontal: 16, fontFamily: fonts.regular, fontSize: 15 },
  primary: { marginTop: 12 },
  foot: { marginTop: 'auto', paddingTop: 32, paddingBottom: 16, textAlign: 'center' },
})
