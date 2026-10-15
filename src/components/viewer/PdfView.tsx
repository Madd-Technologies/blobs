import { useMemo, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { restHeaders, type ServerConfig } from '@/lib/hermes/server'
import { useTheme } from '@/theme/ThemeProvider'

import { PDF_HTML } from './pdfHtml'

export type PdfEvent = { type: 'loaded'; pages: number } | { type: 'page'; page: number; pages: number } | { type: 'progress'; loaded: number; total: number } | { type: 'error'; message: string }

interface Props {
  config: ServerConfig
  /** A path on the server (`/api/fs/download?path=…`, a plugin route): read with your sign-in, a part at a time. */
  path: string
  onEvent: (event: PdfEvent) => void
}

/**
 * A PDF from the server, drawn by pdf.js in a WebView. The page lives at the server's origin, so it reads the document with plain
 * range requests (and your sign-in), fetching only what the pages on screen need; nothing is saved.
 */
export function PdfView({ config, path, onEvent }: Props) {
  const { c } = useTheme()
  const web = useRef<WebView>(null)
  const source = useMemo(() => ({ html: PDF_HTML, baseUrl: config.baseUrl }), [config.baseUrl])

  function onMessage(event: WebViewMessageEvent) {
    let message: { type?: string } & Record<string, unknown>

    try {
      message = JSON.parse(event.nativeEvent.data) as typeof message
    } catch {
      return
    }

    if (message.type === 'ready') {
      const open = { type: 'open', url: `${config.baseUrl}${path}`, headers: restHeaders(config), background: c.canvas }
      web.current?.injectJavaScript(`window.__rn&&window.__rn(${JSON.stringify(open)});true;`)
    } else if (message.type === 'loaded' || message.type === 'page' || message.type === 'progress' || message.type === 'error') {
      onEvent(message as PdfEvent)
    }
  }

  return (
    <WebView
      ref={web}
      source={source}
      originWhitelist={['*']}
      onMessage={onMessage}
      style={[styles.fill, { backgroundColor: c.canvas }]}
      containerStyle={{ backgroundColor: c.canvas }}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      // Pinch to zoom the pages.
      scalesPageToFit
      setBuiltInZoomControls
      setDisplayZoomControls={false}
    />
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
