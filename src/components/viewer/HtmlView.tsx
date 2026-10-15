import { useMemo } from 'react'
import { Linking, StyleSheet } from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'

import { useTheme } from '@/theme/ThemeProvider'

/**
 * A web page a bot made (an HTML file), shown as a page. It runs in a WebView of its own, with no bridge to the app and no origin
 * of the server's, so it can draw and run its scripts but reaches nothing of yours; a link out opens in the browser.
 */
export function HtmlView({ html }: { html: string }) {
  const { c } = useTheme()
  const source = useMemo(() => ({ html, baseUrl: 'about:blank' }), [html])

  function onNavigate(request: WebViewNavigation): boolean {
    if (request.url === 'about:blank' || request.url.startsWith('about:') || request.url.startsWith('data:')) {
      return true
    }

    if (/^https?:\/\//i.test(request.url)) {
      void Linking.openURL(request.url)
    }

    return false
  }

  return (
    <WebView
      source={source}
      originWhitelist={['about:*', 'data:*']}
      onShouldStartLoadWithRequest={onNavigate}
      style={[styles.fill, { backgroundColor: c.canvas }]}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      allowFileAccess={false}
    />
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
