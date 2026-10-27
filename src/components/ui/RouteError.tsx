import { useRouter, type ErrorBoundaryProps } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { Component, useEffect, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Pill } from '@/components/ui/Pill'
import { T } from '@/components/ui/T'
import { useTheme } from '@/theme/ThemeProvider'

/**
 * What a screen shows instead of closing the app when it throws while drawing. The root layout's version can render outside
 * the theme (it then uses the dark default) and before the splash has gone, so it hides the splash itself.
 */
function Fallback({ error, retry, home }: ErrorBoundaryProps & { home?: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined)
  }, [])

  return (
    <View style={[styles.screen, { backgroundColor: c.canvas, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <T variant="title">Something went wrong</T>
      <T variant="body" color="text2">
        Blobs couldn’t show this screen. Try again, and if it keeps happening, let us know what you opened.
      </T>
      {/* Only a development build shows the error: a message can carry a server address. */}
      {__DEV__ ? (
        <T variant="monoSmall" color="text2" selectable>
          {error.message}
        </T>
      ) : null}
      <View style={styles.actions}>
        <Pill label="Try again" variant="primary" onPress={() => void retry()} />
        {home ? <Pill label="Back to Home" onPress={home} /> : null}
      </View>
    </View>
  )
}

/** For the root layout: nothing else is left to go back to. */
export function RootError(props: ErrorBoundaryProps) {
  return <Fallback {...props} />
}

/** For a screen inside the app: also offers Home, since the screen's own header (and its back button) is gone. */
export function ScreenError(props: ErrorBoundaryProps) {
  const router = useRouter()

  return <Fallback {...props} home={() => router.replace('/')} />
}

interface BoundaryProps {
  /** What the children were drawn from: when it changes (a reply still streaming), they get another try. */
  source: string
  fallback: ReactNode
  children: ReactNode
}

/** Keeps one piece of a message that fails to draw (odd markdown, math or a diagram) from taking the whole chat down. */
export class PieceBoundary extends Component<BoundaryProps, { failed: string | null }> {
  state = { failed: null as string | null }

  static getDerivedStateFromError() {
    return { failed: '' }
  }

  componentDidCatch() {
    this.setState({ failed: this.props.source })
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.failed !== null && previous.source !== this.props.source) {
      this.setState({ failed: null })
    }
  }

  render() {
    return this.state.failed !== null ? this.props.fallback : this.props.children
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', gap: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
})
