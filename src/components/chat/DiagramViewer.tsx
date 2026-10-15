import { useMemo, useState } from 'react'
import { Modal, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import { IconCircle } from '@/components/ui/IconCircle'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { diagramKind } from '@/lib/hermes/diagram'
import { useDiagram } from '@/stores/diagram'
import { useTheme } from '@/theme/ThemeProvider'

/** The page that draws one diagram. `script` is Mermaid itself (about 5 MB): it is only read when a diagram is opened. */
function pageFor(source: string, script: string, scheme: 'dark' | 'light', background: string, foreground: string): string {
  // The source goes in as a JSON string, so nothing in it can end the script tag or the string.
  const json = JSON.stringify(source).replace(/</g, '\\u003c')

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=0.2,maximum-scale=6,user-scalable=yes">
<style>html,body{margin:0;background:${background};color:${foreground};font-family:-apple-system,system-ui,sans-serif}#out{padding:24px 16px;display:flex;justify-content:center}svg{max-width:none!important;height:auto}pre{white-space:pre-wrap;font-size:14px}</style>
</head><body><div id="out"></div>
<script>${script}</script>
<script>
(async function () {
  var out = document.getElementById('out')
  try {
    mermaid.initialize({ startOnLoad: false, theme: ${JSON.stringify(scheme === 'dark' ? 'dark' : 'neutral')}, securityLevel: 'strict', fontFamily: '-apple-system, system-ui, sans-serif' })
    var result = await mermaid.render('diagram', ${json})
    out.innerHTML = result.svg
    window.ReactNativeWebView.postMessage('drawn')
  } catch (error) {
    out.innerHTML = '<pre></pre>'
    out.firstChild.textContent = 'This diagram could not be drawn.\\n\\n' + String((error && error.message) || error)
    window.ReactNativeWebView.postMessage('failed')
  }
})()
</script></body></html>`
}

function Page({ source }: { source: string }) {
  const { c, scheme } = useTheme()
  const insets = useSafeAreaInsets()
  const close = useDiagram(state => state.close)
  const [drawn, setDrawn] = useState(false)
  // Mermaid is read here and not at the top of the file: the app does not carry its 5 MB into memory until a diagram is opened.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const html = useMemo(() => pageFor(source, (require('./mermaidHtml') as typeof import('./mermaidHtml')).MERMAID_JS, scheme, c.canvas, c.text), [source, scheme, c.canvas, c.text])

  return (
    <View style={[styles.screen, { backgroundColor: c.canvas }]}>
      <WebView
        source={{ html, baseUrl: 'about:blank' }}
        originWhitelist={['about:*']}
        // Nothing on the page links anywhere: a diagram that tries to leave is not followed.
        onShouldStartLoadWithRequest={request => request.url.startsWith('about:')}
        onMessage={() => setDrawn(true)}
        style={[styles.web, { backgroundColor: c.canvas, marginTop: insets.top + 60 }]}
        containerStyle={{ backgroundColor: c.canvas }}
        scrollEnabled
        bounces={false}
        accessibilityLabel={`${diagramKind(source)}`}
      />
      {!drawn ? (
        <View style={styles.loading} pointerEvents="none">
          <Spinner size={18} />
        </View>
      ) : null}
      <View style={[styles.top, { top: insets.top + 8 }]}>
        <T variant="heading" numberOfLines={1} style={styles.title}>
          {diagramKind(source)}
        </T>
        <IconCircle icon="x" label="Close" diameter={44} onPress={close} />
      </View>
    </View>
  )
}

/** A Mermaid diagram, full screen: drawn in a page that works offline, with pinch to zoom. Mounted once, at the root. */
export function DiagramViewer() {
  const source = useDiagram(state => state.source)
  const close = useDiagram(state => state.close)

  return (
    <Modal visible={source !== null} animationType="fade" onRequestClose={close} statusBarTranslucent>
      {source !== null ? <Page key={source} source={source} /> : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  web: { flex: 1 },
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 20, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1 },
})
