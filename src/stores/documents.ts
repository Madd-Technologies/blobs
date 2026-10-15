import { router } from 'expo-router'
import { Linking } from 'react-native'
import { create } from 'zustand'

import { driveFileId, openInGoogle, type DriveFile } from '@/features/viewer/drive'
import { fileName, viewerKind } from '@/features/viewer/kind'
import { restJson } from '@/lib/hermes/server'
import { useConnection } from '@/stores/connection'
import { toast } from '@/stores/toast'
import { useViewer } from '@/stores/viewer'

/**
 * Something to read in the viewer: a file on the server (by absolute path), something a server plugin serves (a route such as a
 * Paperless document), or the change an edit made. Nothing is saved to the phone: the viewer reads it from the server when shown.
 */
export type ViewerDoc =
  | { kind: 'file'; path: string; name: string; profile?: string }
  | { kind: 'route'; href: string; name: string }
  | { kind: 'diff'; diff: string; name: string }

interface DocumentState {
  /** Each viewer screen's document, by the key in its route, so a viewer opened from a link in another keeps its own. */
  docs: Record<string, ViewerDoc>
}

/** The most viewer screens that can be stacked; the oldest documents are forgotten past this. */
const KEEP = 12

export const useDocument = create<DocumentState>(() => ({ docs: {} }))

let opened = 0

/**
 * Opens a document: a picture in the picture viewer, a Google Doc, Sheet or deck in Google's own app, anything else on the viewer
 * page.
 */
export function openDocument(doc: ViewerDoc): void {
  if (doc.kind === 'file' && viewerKind(doc.path) === 'image') {
    useViewer.getState().open({ name: doc.name, path: doc.path, profile: doc.profile })

    return
  }

  const driveId = doc.kind === 'route' ? driveFileId(doc.href) : null

  if (driveId) {
    void openDriveFile(driveId, doc)

    return
  }

  showInViewer(doc)
}

function showInViewer(doc: ViewerDoc) {
  const key = `d${(opened += 1)}`

  useDocument.setState(state => ({ docs: Object.fromEntries([...Object.entries(state.docs), [key, doc]].slice(-KEEP)) }))
  router.push({ pathname: '/viewer', params: { key } })
}

/** One tap at a time: a second tap while the first is being looked up is ignored. */
let lookingUp = false

/**
 * A Drive file: asks the server what it is, then opens a Google file where it lives and shows any other file in the viewer. If
 * the server cannot say, or Google's link will not open, the viewer shows it.
 */
async function openDriveFile(id: string, doc: ViewerDoc) {
  const config = useConnection.getState().config

  if (lookingUp || !config) {
    return config ? undefined : showInViewer(doc)
  }

  lookingUp = true

  try {
    const file = await restJson<DriveFile>(config, `/api/plugins/hermes-drive/files/${encodeURIComponent(id)}`, {}, { timeoutMs: 8000 }).catch(() => null)
    const google = file ? openInGoogle(file) : null

    if (google && (await Linking.openURL(google.url).then(() => true, () => false))) {
      toast(`Opened in ${google.app}`)

      return
    }

    showInViewer(doc)
  } finally {
    lookingUp = false
  }
}

export const openFile = (path: string, profile?: string, name: string = fileName(path)) => openDocument({ kind: 'file', path, name, profile })
