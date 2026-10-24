import Feather from '@expo/vector-icons/Feather'
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist'
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono'
import { useFonts } from 'expo-font'
import * as ScreenOrientation from 'expo-screen-orientation'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { useBoot } from '@/stores/boot'
import { useConnection } from '@/stores/connection'
import { prefsHydrated, usePrefs } from '@/stores/prefs'
import { startSessionSync } from '@/stores/sync'
import { BootSplash } from '@/components/boot/BootSplash'
import { DiagramViewer } from '@/components/chat/DiagramViewer'
import { ImageViewer } from '@/components/chat/ImageViewer'
import { RestartingScreen } from '@/components/restart/RestartingScreen'
import { RestartSheet } from '@/components/restart/RestartSheet'
import { ToastHost } from '@/components/ui/ToastHost'
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider'

void SplashScreen.preventAutoHideAsync()
// The animated splash takes over on the native splash's own frame, so the native one may go quickly (Android fades it).
SplashScreen.setOptions({ duration: 200 })

/** Whatever opens the app (a notification, a link) lands with Home underneath, so back goes Home instead of leaving the app. */
export const unstable_settings = { anchor: 'index' }

function RootStack() {
  const { c, scheme } = useTheme()
  const configured = useConnection(s => s.config !== null)

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.canvas)
  }, [c.canvas])

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.canvas },
          animation: 'slide_from_right',
          // A screen under another one (Home under a chat, a chat under its dashboard) doesn't re-render until it is back on
          // top: its stores keep updating, but nothing it draws is seen meanwhile.
          freezeOnBlur: true,
        }}
      >
        <Stack.Protected guard={configured}>
          <Stack.Screen name="index" />
          <Stack.Screen name="inbox" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="plugins" />
          <Stack.Screen name="phone/index" />
          <Stack.Screen name="phone/never-share" />
          <Stack.Screen name="screens/index" />
          <Stack.Screen name="screens/[profile]" />
          {/* One screen per bot (and per room): opening a bot that is already open brings that screen up instead of a second copy
              sharing its session. */}
          <Stack.Screen name="bot/[profile]/index" dangerouslySingular />
          {/* A call comes up from the bottom over its chat and goes back down to it; the call goes on in the chat's bar. */}
          <Stack.Screen name="bot/[profile]/call" dangerouslySingular options={{ animation: 'slide_from_bottom', gestureDirection: 'vertical' }} />
          <Stack.Screen name="bot/[profile]/dashboard" />
          <Stack.Screen name="bot/[profile]/view" />
          <Stack.Screen name="bot/[profile]/record" />
          <Stack.Screen name="bot/[profile]/chats" />
          <Stack.Screen name="bot/[profile]/details" />
          <Stack.Screen name="bot/[profile]/edit" />
          <Stack.Screen name="bot/[profile]/look" />
          <Stack.Screen name="bot/[profile]/model" />
          <Stack.Screen name="bot/[profile]/skills" />
          <Stack.Screen name="bot/[profile]/routines" />
          <Stack.Screen name="bot/[profile]/tools" />
          <Stack.Screen name="bot/[profile]/runs-on" />
          <Stack.Screen name="bot/[profile]/past" />
          <Stack.Screen name="bot/[profile]/errand" />
          <Stack.Screen name="bot/[profile]/errand-call" />
          <Stack.Screen name="room/new" />
          <Stack.Screen name="room/[id]" dangerouslySingular />
          <Stack.Screen name="bot/new" />
          <Stack.Screen name="viewer" />
        </Stack.Protected>
        <Stack.Protected guard={!configured}>
          <Stack.Screen name="connect" options={{ animation: 'fade' }} />
        </Stack.Protected>
        {/* The tutorial: before Connect on a first launch, and from Settings any time. Its pages swipe sideways, so the
            back swipe stays off; Android's back button and its own buttons close it. */}
        <Stack.Screen name="tour" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <ImageViewer />
      <DiagramViewer />
      <RestartingScreen />
      <RestartSheet />
      <ToastHost />
    </>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
    // Preload the icon font so glyphs don't pop in after first paint.
    ...Feather.font,
  })
  const hydrated = useConnection(s => s.hydrated)
  const [prefsReady, setPrefsReady] = useState(false)
  const splashDone = useBoot(s => s.splashDone)

  useEffect(() => {
    // app.json orientation is "default"; the app itself stays portrait (taking over a bot's screen included).
    if (Platform.OS !== 'web') {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT).catch(() => {})
    }
    const connection = useConnection.getState().hydrate()
    void connection.then(() => useConnection.getState().connect())
    void Promise.all([connection.catch(() => undefined), prefsHydrated()]).then(() => {
      // Someone already connected (from before the tutorial existed) knows the app: it never opens on its own for them.
      if (useConnection.getState().config) usePrefs.getState().setTourSeen()
      setPrefsReady(true)
    })
    return startSessionSync()
  }, [])

  // The native splash stays up until this first frame; the animated splash then takes over and hides it.
  const ready = fontsLoaded && hydrated && prefsReady
  if (!ready) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <RootStack />
        {splashDone ? null : <BootSplash />}
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
