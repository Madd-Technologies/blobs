import { useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import mathAsset from '../../../assets/web/math.html'
import { loadTextAsset } from '@/lib/webAsset'
import { resolveMath, useMathWorker, type PendingMathJob } from '@/stores/mathWorker'

function WorkerRunner({ pending }: { pending: PendingMathJob[] }) {
  const webRef = useRef<WebView>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const sent = useRef(new Set<string>())

  useEffect(() => {
    let live = true

    void loadTextAsset(mathAsset).then(
      text => {
        if (live) {
          setHtml(text)
        }
      },
      () => {
        // Resolve queued formulas with null on load failure so they stay in mono fallback cleanly.
        for (const job of useMathWorker.getState().pending) {
          resolveMath(job.key, null)
        }
      },
    )

    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!ready || !webRef.current) {
      return
    }

    const batch: PendingMathJob[] = []

    for (const job of pending) {
      if (!sent.current.has(job.key)) {
        sent.current.add(job.key)
        batch.push(job)
      }
    }

    if (!batch.length) {
      return
    }

    const script = batch
      .map(job => `window.__renderMath?.(${JSON.stringify(job.key)},${JSON.stringify(job.tex)},${job.display ? 'true' : 'false'});`)
      .join('')

    webRef.current.injectJavaScript(`${script}true;`)
  }, [ready, pending])

  function onMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as { ready?: boolean; key?: string; svg?: string | null }

      if (msg.ready) {
        setReady(true)

        return
      }

      if (typeof msg.key === 'string') {
        sent.current.delete(msg.key)
        resolveMath(msg.key, typeof msg.svg === 'string' ? msg.svg : null)
      }
    } catch {
      // Ignore malformed worker bridge messages.
    }
  }

  if (!html) {
    return null
  }

  return (
    <View pointerEvents="none" style={styles.host}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: 'about:blank' }}
        originWhitelist={['about:*']}
        onMessage={onMessage}
        style={styles.web}
      />
    </View>
  )
}

export function MathWorkerHost() {
  const active = useMathWorker(state => state.active)
  const pending = useMathWorker(state => state.pending)

  if (Platform.OS === 'web' || !active) {
    return null
  }

  return <WorkerRunner pending={pending} />
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10, overflow: 'hidden' },
  web: { width: 1, height: 1, opacity: 0 },
})
