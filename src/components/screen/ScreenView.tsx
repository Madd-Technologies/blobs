import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { parseViewerMessage, type ViewerEvent } from '@/features/display/viewer'

import { NOVNC_HTML } from './novncHtml'

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
  const source = useMemo(() => ({ html: NOVNC_HTML, baseUrl }), [baseUrl])

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
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#2B2E34' },
  web: { flex: 1, backgroundColor: '#2B2E34' },
})
