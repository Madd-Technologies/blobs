import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import pdfAsset from '../../../assets/web/pdf.html'
import { Spinner } from '@/components/ui/Spinner'
import { restHeaders, type ServerConfig } from '@/lib/hermes/server'
import { loadTextAsset } from '@/lib/webAsset'
import { useTheme } from '@/theme/ThemeProvider'

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
  const [html, setHtml] = useState<string | null>(null)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    let live = true

    void loadTextAsset(pdfAsset).then(
      text => {
        if (live) {
          setHtml(text)
        }
      },
      error => {
        if (live) {
          onEventRef.current({ type: 'error', message: error instanceof Error ? error.message : 'Could not load PDF viewer.' })
        }
      },
    )

    return () => {
      live = false
    }
  }, [])

  const source = useMemo(() => (html ? { html, baseUrl: config.baseUrl } : null), [html, config.baseUrl])

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

  if (!source) {
    return (
      <View style={[styles.loading, { backgroundColor: c.canvas }]}>
        <Spinner size={18} />
      </View>
    )
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
