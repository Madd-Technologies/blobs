import { useMemo } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'

import { sealedDocument } from '@/features/dashboard/sealed'

/**
 * An HTML draft drawn exactly as it would go out, sealed: JavaScript is off, the page may not navigate or open windows, and
 * its policy loads nothing from anywhere. It draws on white paper, like the email it is, whatever the app's theme.
 */
export function SealedHtml({ html, style, scroll = true }: { html: string; style?: StyleProp<ViewStyle>; scroll?: boolean }) {
  const source = useMemo(() => ({ html: sealedDocument(html), baseUrl: 'about:blank' }), [html])

  return (
    <WebView
      source={source}
      originWhitelist={['about:*']}
      // Only the document itself loads; a link tapped in the draft goes nowhere.
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith('about:srcdoc')}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      allowsLinkPreview={false}
      cacheEnabled={false}
      incognito
      mixedContentMode="never"
      dataDetectorTypes="none"
      mediaPlaybackRequiresUserAction
      scrollEnabled={scroll}
      nestedScrollEnabled
      style={[styles.fill, style]}
      accessibilityLabel="The draft as it will be sent"
    />
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#ffffff' },
})
