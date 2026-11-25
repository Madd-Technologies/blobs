import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import novncAsset from '../../../assets/web/novnc.html'
import { parseViewerMessage, type ViewerEvent } from '@/features/display/viewer'
import { loadTextAsset } from '@/lib/webAsset'

export interface ScreenViewHandle {
  /** Open the display websocket. The URL carries a single-use ticket: never log it. */
  connect: (url: string, viewOnly: boolean) => void
  setViewOnly: (viewOnly: boolean) => void
  /** Fit the whole screen into the view (true), or show it at its own size. */
  setFit: (fit: boolean) => void
  disconnect: () => void
  /** One key event (an X keysym); `down` omitted presses and releases. */
  key: (keysym: number, code?: string, down?: boolean) => void
  paste: (text: string) => void
}

interface Props {
  /** The server's address: the page is served as if from it, so the display socket is same-origin. */
  baseUrl: string
  onEvent: (event: ViewerEvent) => void
  style?: StyleProp<ViewStyle>
}

/** noVNC in a WebView, driven by messages. The page posts `ready` once it can take commands. */
export const ScreenView = forwardRef<ScreenViewHandle, Props>(function ScreenView({ baseUrl, onEvent, style }, ref) {
  const web = useRef<WebView>(null)
  const [html, setHtml] = useState<string | null>(null)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    let live = true

    void loadTextAsset(novncAsset).then(
      text => {
        if (live) {
          setHtml(text)
        }
      },
      error => {
        if (live) {
          onEventRef.current({ type: 'error', message: error instanceof Error ? error.message : 'Could not load screen viewer.' })
        }
      },
    )

    return () => {
      live = false
    }
  }, [])

  const source = useMemo(() => (html ? { html, baseUrl } : null), [html, baseUrl])

  function send(message: Record<string, unknown>) {
    // The page defines `__rn` when its script has loaded; a command sent before that is dropped, not an error.
    web.current?.injectJavaScript(`window.__rn&&window.__rn(${JSON.stringify(message)});true;`)
  }

  useImperativeHandle(ref, () => ({
    connect: (url, viewOnly) => send({ type: 'connect', url, viewOnly }),
    setViewOnly: viewOnly => send({ type: 'viewOnly', value: viewOnly }),
    setFit: fit => send({ type: 'fit', value: fit }),
    disconnect: () => send({ type: 'disconnect' }),
    key: (keysym, code, down) => send({ type: 'key', keysym, code, ...(down === undefined ? {} : { down }) }),
    paste: text => send({ type: 'paste', text }),
  }))

  function onMessage(event: WebViewMessageEvent) {
    const parsed = parseViewerMessage(event.nativeEvent.data)

    if (parsed) {
      onEvent(parsed)
    }
  }

  return (
    <View style={[styles.fill, style]}>
      {source ? (
        <WebView
          ref={web}
          source={source}
          originWhitelist={['*']}
          onMessage={onMessage}
          // The page is loaded once and kept: it holds the connection. If iOS kills its process (memory), load it
          // again; it posts `ready` and the caller redials.
          onContentProcessDidTerminate={() => web.current?.reload()}
          javaScriptEnabled
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          hideKeyboardAccessoryView
          style={styles.web}
        />
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#2B2E34' },
  web: { flex: 1, backgroundColor: '#2B2E34' },
})
