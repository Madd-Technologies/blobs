import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'

import { DiffView } from '@/components/viewer/DiffView'
import { HtmlView } from '@/components/viewer/HtmlView'
import { PdfView, type PdfEvent } from '@/components/viewer/PdfView'
import { TextView } from '@/components/viewer/TextView'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { diffStat, parseDiff } from '@/features/viewer/diff'
import { viewerKind, type ViewerKind } from '@/features/viewer/kind'
import { HermesHttpError, restHeaders, restJson, type ServerConfig } from '@/lib/hermes/server'
import { useConnection } from '@/stores/connection'
import { useDocument, type ViewerDoc } from '@/stores/documents'

type Shown =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'pdf'; path: string }
  | { phase: 'image'; uri: string; headers: Record<string, string> }
  | { phase: 'text'; text: string; kind: ViewerKind; truncated?: boolean; size?: number }
  | { phase: 'html'; html: string }
  | { phase: 'diff'; diff: string }
  | { phase: 'binary'; size?: number; type?: string }

interface ReadText {
  binary?: boolean
  byteSize?: number
  mimeType?: string
  text?: string
  truncated?: boolean
}

const query = (doc: Extract<ViewerDoc, { kind: 'file' }>) => `path=${encodeURIComponent(doc.path)}${doc.profile ? `&profile=${encodeURIComponent(doc.profile)}` : ''}`

/** Works out how to show a document, reading as little of it as that takes. */
async function resolve(config: ServerConfig, doc: ViewerDoc): Promise<Shown> {
  if (doc.kind === 'diff') {
    return { phase: 'diff', diff: doc.diff }
  }

  if (doc.kind === 'file') {
    const kind = viewerKind(doc.path)

    // pdf.js reads it a part at a time from the download route.
    if (kind === 'pdf') {
      return { phase: 'pdf', path: `/api/fs/download?${query(doc)}` }
    }

    const read = await restJson<ReadText>(config, `/api/fs/read-text?path=${encodeURIComponent(doc.path)}`)
    const typed = viewerKind(doc.path, read.mimeType)

    if (typed === 'pdf') {
      return { phase: 'pdf', path: `/api/fs/download?${query(doc)}` }
    }

    if (read.binary || read.text === undefined) {
      return { phase: 'binary', size: read.byteSize, type: read.mimeType }
    }

    return typed === 'html' ? { phase: 'html', html: read.text } : { phase: 'text', text: read.text, kind: typed === 'other' ? 'text' : typed, truncated: read.truncated, size: read.byteSize }
  }

  // A plugin route: its type decides. A PDF or picture is left to its viewer to read (the body is not waited for here).
  const controller = new AbortController()
  const response = await fetch(`${config.baseUrl}${doc.href}`, { headers: restHeaders(config), signal: controller.signal })

  if (!response.ok) {
    controller.abort()
    throw new HermesHttpError(response.status, `GET ${doc.href} → ${response.status}`)
  }

  const type = response.headers.get('content-type')
  const kind = viewerKind(doc.href, type)

  if (kind === 'pdf' || kind === 'image' || kind === 'other') {
    controller.abort()

    return kind === 'pdf' ? { phase: 'pdf', path: doc.href } : kind === 'image' ? { phase: 'image', uri: `${config.baseUrl}${doc.href}`, headers: restHeaders(config) } : { phase: 'binary', type: type ?? undefined }
  }

  const text = await response.text()

  return kind === 'html' ? { phase: 'html', html: text } : { phase: 'text', text, kind }
}

function failure(error: unknown): string {
  if (error instanceof HermesHttpError) {
    return error.status === 404 ? 'That file is no longer on the server.' : error.status === 403 ? 'The server will not open that file.' : error.status === 413 ? 'That file is too large to open here.' : 'Could not open it.'
  }

  return error instanceof Error && error.name !== 'AbortError' ? error.message : 'Could not open it.'
}

function sizeLabel(bytes?: number): string {
  if (bytes === undefined) {
    return ''
  }

  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A file, plugin document or change, read from the server while you look at it. Nothing is saved to the phone. */
export default function ViewerScreen() {
  const { key } = useLocalSearchParams<{ key?: string }>()
  const doc = useDocument(state => (key ? state.docs[key] : undefined) ?? null)
  const config = useConnection(state => state.config)
  // What was worked out, and for which document: a result for another one (opened over this) is not shown.
  const [result, setResult] = useState<{ doc: ViewerDoc; shown: Shown } | null>(null)
  const [pages, setPages] = useState<{ doc: ViewerDoc; page: number; pages: number } | null>(null)
  const shown: Shown = result && result.doc === doc ? result.shown : { phase: 'loading' }
  const page = pages && pages.doc === doc ? pages : null

  useEffect(() => {
    if (!doc || !config) {
      return
    }

    let cancelled = false
    resolve(config, doc).then(
      next => !cancelled && setResult({ doc, shown: next }),
      error => !cancelled && setResult({ doc, shown: { phase: 'error', message: failure(error) } }),
    )

    return () => {
      cancelled = true
    }
  }, [doc, config])

  function onPdf(event: PdfEvent) {
    if (!doc) {
      return
    }

    if (event.type === 'loaded') {
      setPages({ doc, page: 1, pages: event.pages })
    } else if (event.type === 'page') {
      setPages({ doc, page: event.page, pages: event.pages })
    } else if (event.type === 'error') {
      setResult({ doc, shown: { phase: 'error', message: event.message } })
    }
  }

  const subtitle =
    shown.phase === 'pdf' && page
      ? `Page ${page.page} of ${page.pages}`
      : shown.phase === 'diff'
        ? (({ added, removed }) => `+${added} −${removed}`)(diffStat(parseDiff(shown.diff)))
        : shown.phase === 'text' && shown.truncated
          ? `The first 512 KB of ${sizeLabel(shown.size)}`
          : undefined

  return (
    <Screen edges={['top']}>
      <ScreenHeader compact title={doc?.name ?? 'File'} subtitle={subtitle} />
      <View style={styles.fill}>
        {!doc || !config ? (
          <Centered text="Nothing to show." />
        ) : shown.phase === 'loading' ? (
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        ) : shown.phase === 'error' ? (
          <Centered text={shown.message} />
        ) : shown.phase === 'pdf' ? (
          <PdfView config={config} path={shown.path} onEvent={onPdf} />
        ) : shown.phase === 'image' ? (
          <Image source={{ uri: shown.uri, headers: shown.headers }} style={styles.fill} resizeMode="contain" />
        ) : shown.phase === 'text' ? (
          <TextView text={shown.text} kind={shown.kind} />
        ) : shown.phase === 'html' ? (
          <HtmlView html={shown.html} />
        ) : shown.phase === 'diff' ? (
          <DiffView diff={shown.diff} />
        ) : (
          <Centered text={`This file can’t be shown here${shown.type ? ` (${shown.type}` : ''}${shown.size !== undefined ? `${shown.type ? ', ' : ' ('}${sizeLabel(shown.size)})` : shown.type ? ')' : ''}.`} />
        )}
      </View>
    </Screen>
  )
}

function Centered({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <T variant="secondary" color="text2" style={styles.centered}>
        {text}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  centered: { textAlign: 'center' },
})
