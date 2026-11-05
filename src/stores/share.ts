import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { DOWNLOADS_URI, folderLabel, freeName, getFailure, savedToast, sendFailure, sentToast } from '@/features/share/model'
import { HermesHttpError, restHeaders, type ServerConfig } from '@/lib/hermes/server'
import { RestartRefused } from '@/lib/hermes/restart'
import { cancelTaildropSend, getTaildrop, getTaildropSend, sendTaildrop, type TaildropStatus, type TaildropTarget } from '@/lib/hermes/taildrop'
import { useConnection } from '@/stores/connection'
import type { ViewerDoc } from '@/stores/documents'
import { toast } from '@/stores/toast'

/** A share line under the viewer's title, while something is under way or went wrong. */
export type ShareLine =
  | { kind: 'idle' }
  /** Getting the file onto this phone, to share it or to save it; the line shows only past half a second. */
  | { kind: 'getting'; purpose: 'share' | 'download'; done: number; total: number | null; visible: boolean }
  | { kind: 'sending'; id: string; target: TaildropTarget; sent: number | null; total: number | null }
  | { kind: 'error'; message: string; retry: 'share' | 'download' | 'taildrop'; target?: TaildropTarget }

interface ShareState {
  /** The server's Taildrop status: undefined until read, null without the route. */
  taildrop: TaildropStatus | null | undefined
  /** Each viewer screen's line, by its document key. */
  lines: Record<string, ShareLine>
  /** The device sheet, for one viewer screen. */
  sheetFor: string | null
  /** Android's share sheet (Download, Share), for one viewer screen. */
  phoneSheetFor: string | null
  loadTaildrop: () => Promise<void>
  openSheet: (key: string) => void
  closeSheet: () => void
  openPhoneSheet: (key: string) => void
  closePhoneSheet: () => void
  share: (key: string, doc: ViewerDoc) => Promise<void>
  /** Saves it to the folder picked once (Android), or to another one with `pick`. */
  download: (key: string, doc: ViewerDoc, options?: { pick?: boolean }) => Promise<void>
  send: (key: string, doc: ViewerDoc, target: TaildropTarget) => Promise<void>
  cancel: (key: string) => void
  clear: (key: string) => void
}

/** The last device sent to, per server, so it comes second in the sheet. */
export const useLastTarget = create<{ byServer: Record<string, string>; remember: (server: string, name: string) => void }>()(
  persist(
    set => ({
      byServer: {},
      remember: (server, name) => set(state => ({ byServer: { ...state.byServer, [server]: name } })),
    }),
    { name: 'blobs.taildrop', storage: createJSONStorage(() => AsyncStorage), partialize: state => ({ byServer: state.byServer }) },
  ),
)

/** The folder downloads go to (Android): a folder the person picked once, kept with its access across restarts. */
export const useDownloadFolder = create<{ uri: string | null; set: (uri: string | null) => void }>()(
  persist(
    set => ({
      uri: null,
      set: uri => set({ uri }),
    }),
    { name: 'blobs.downloads', storage: createJSONStorage(() => AsyncStorage), partialize: state => ({ uri: state.uri }) },
  ),
)

/** Whether this phone saves files itself (Android); iOS saves through the share sheet's Save to Files. */
export const canDownload = Platform.OS === 'android'

/** Running downloads and sends, by document key, so Cancel can stop them. */
const running = new Map<string, { abort?: AbortController; poll?: ReturnType<typeof setInterval>; config: ServerConfig; sendId?: string }>()

/** Where a document is downloaded from for sharing, or null when it is not a file on the server (a change). */
function downloadUrl(config: ServerConfig, doc: ViewerDoc): string | null {
  if (doc.kind === 'file') {
    return `${config.baseUrl}/api/fs/download?path=${encodeURIComponent(doc.path)}${doc.profile ? `&profile=${encodeURIComponent(doc.profile)}` : ''}`
  }

  return doc.kind === 'route' ? `${config.baseUrl}${doc.href}` : null
}

/** The app's own cache folder for shared files, emptied before each share (never the phone's Downloads). */
function shareFolder(): Directory {
  const folder = new Directory(Paths.cache, 'share')

  try {
    if (folder.exists) {
      folder.delete()
    }

    folder.create({ intermediates: true })
  } catch {
    // A file still open by the last share sheet: the new one gets its own name below.
  }

  return folder
}

/** A file name the phone's file system takes. */
const safeName = (name: string) => name.replace(/[/\\:*?"<>|]+/g, '-').slice(0, 120) || 'file'

/** What the document is called as a file on this phone (a change is a .patch). */
const fileName = (doc: ViewerDoc) => (doc.kind === 'diff' ? `${safeName(doc.name)}.patch` : safeName(doc.name))

/**
 * The folder to save in: the one picked before while it is still there, else Android's folder picker, opened at
 * Download (a new pick is kept). Null when the person backed out of the picker.
 */
async function downloadFolder(pick: boolean): Promise<Directory | null> {
  const saved = useDownloadFolder.getState().uri

  if (saved && !pick) {
    try {
      const folder = new Directory(saved)

      if (folder.exists) {
        return folder
      }
    } catch {
      // Its access was taken back: pick again.
    }
  }

  try {
    const folder = await Directory.pickDirectoryAsync(saved ?? DOWNLOADS_URI)
    useDownloadFolder.getState().set(folder.uri)

    return folder
  } catch {
    return null
  }
}

export const useShare = create<ShareState>((set, get) => {
  const setLine = (key: string, line: ShareLine) => set(state => ({ lines: { ...state.lines, [key]: line } }))
  const stop = (key: string) => {
    const job = running.get(key)

    if (job?.poll) {
      clearInterval(job.poll)
    }

    running.delete(key)
  }

  /**
   * The document as a file in the app's own cache (named `name`, else its own name), with the line under the title while
   * it comes: a change is written here as a .patch, a file is downloaded from the server. Null when cancelled or failed
   * (the line then says why).
   */
  const fetchToPhone = async (key: string, doc: ViewerDoc, purpose: 'share' | 'download', name: string = fileName(doc)): Promise<File | null> => {
    const config = useConnection.getState().config

    if (!config || running.has(key)) {
      return null
    }

    try {
      if (doc.kind === 'diff') {
        // A change is made on the phone, as a .patch file.
        const file = new File(shareFolder(), name)
        file.write(doc.diff)
        setLine(key, { kind: 'idle' })

        return file
      }

      const url = downloadUrl(config, doc)

      if (!url) {
        return null
      }

      const abort = new AbortController()
      running.set(key, { abort, config })
      setLine(key, { kind: 'getting', purpose, done: 0, total: null, visible: false })
      // Ready within half a second: no line at all.
      const reveal = setTimeout(() => {
        const line = get().lines[key]

        if (line?.kind === 'getting') {
          setLine(key, { ...line, visible: true })
        }
      }, 500)
      const task = File.createDownloadTask(url, new File(shareFolder(), name), {
        headers: restHeaders(config),
        signal: abort.signal,
        // You are waiting for it: iOS's default background session adds seconds after the last byte.
        sessionType: 'foreground',
        onProgress: ({ bytesWritten, totalBytes }) => {
          const line = get().lines[key]

          if (line?.kind === 'getting') {
            setLine(key, { ...line, done: bytesWritten, total: totalBytes > 0 ? totalBytes : null })
          }
        },
      })

      let file: File | null

      try {
        file = await task.downloadAsync()
      } finally {
        clearTimeout(reveal)
        stop(key)
      }

      setLine(key, { kind: 'idle' })

      return file
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setLine(key, { kind: 'idle' })

        return null
      }

      const status = error instanceof HermesHttpError ? error.status : (Number(/\b([45]\d\d)\b/.exec(String(error))?.[1]) || null)
      setLine(key, { kind: 'error', message: `Couldn’t get the file · ${getFailure(status)}`, retry: purpose })

      return null
    }
  }

  return {
    taildrop: undefined,
    lines: {},
    sheetFor: null,
    phoneSheetFor: null,

    async loadTaildrop() {
      const config = useConnection.getState().config

      if (!config) {
        return
      }

      try {
        set({ taildrop: await getTaildrop(config) })
      } catch {
        // Unreachable for now: Share from this phone still works, and the next viewer asks again.
      }
    },

    openSheet(key) {
      set({ sheetFor: key })
      void get().loadTaildrop()
    },

    closeSheet() {
      set({ sheetFor: null })
    },

    openPhoneSheet(key) {
      set({ phoneSheetFor: key })
    },

    closePhoneSheet() {
      set({ phoneSheetFor: null })
    },

    async share(key, doc) {
      set({ phoneSheetFor: null })
      const file = await fetchToPhone(key, doc, 'share')

      if (!file) {
        return
      }

      try {
        await Sharing.shareAsync(file.uri, { dialogTitle: doc.name, ...(doc.kind === 'diff' ? { mimeType: 'text/x-diff' } : {}) })
      } catch {
        // The share sheet could not open, or was closed: nothing was lost, and the button is there to try again.
      }
    },

    async download(key, doc, options = {}) {
      set({ phoneSheetFor: null })

      if (!canDownload || running.has(key)) {
        return
      }

      const folder = await downloadFolder(options.pick === true)

      if (!folder) {
        return
      }

      let name: string

      try {
        // Named before it is fetched, so the copy keeps the name: a file already there is never replaced.
        name = freeName(fileName(doc), folder.list().map(entry => entry.name))
      } catch {
        // The folder went away, or its access was taken back: pick it again next time.
        useDownloadFolder.getState().set(null)
        setLine(key, { kind: 'error', message: 'Couldn’t open the folder · pick it again', retry: 'download' })

        return
      }

      const file = await fetchToPhone(key, doc, 'download', name)

      if (!file) {
        return
      }

      try {
        await file.copy(folder)
        toast(savedToast(folderLabel(folder.uri), name))
      } catch {
        useDownloadFolder.getState().set(null)
        setLine(key, { kind: 'error', message: 'Couldn’t save it there · pick the folder again', retry: 'download' })
      }
    },

    async send(key, doc, target) {
      const config = useConnection.getState().config

      if (!config || doc.kind !== 'file' || running.has(key)) {
        return
      }

      set({ sheetFor: null })
      useLastTarget.getState().remember(config.baseUrl, target.name)

      try {
        const started = await sendTaildrop(config, { target: target.ip || target.name, path: doc.path, profile: doc.profile, name: doc.name })
        setLine(key, { kind: 'sending', id: started.id, target, sent: started.sent_bytes, total: started.total_bytes })
        const poll = setInterval(() => {
          void getTaildropSend(config, started.id).then(
            progress => {
              if (progress.state === 'running') {
                setLine(key, { kind: 'sending', id: started.id, target, sent: progress.sent_bytes, total: progress.total_bytes })

                return
              }

              stop(key)

              if (progress.state === 'done') {
                setLine(key, { kind: 'idle' })
                toast(sentToast(target))
              } else if (progress.state === 'cancelled') {
                setLine(key, { kind: 'idle' })
              } else {
                if (progress.setup) {
                  // The one-time setup step: the sheet shows it the next time it opens.
                  set(state => ({ taildrop: state.taildrop ? { ...state.taildrop, setup: progress.setup } : state.taildrop }))
                }

                setLine(key, { kind: 'error', message: `Couldn’t send · ${sendFailure(target.you ? 'This phone' : target.name, progress.error)}`, retry: 'taildrop', target })
              }
            },
            () => undefined,
          )
        }, 1000)
        running.set(key, { poll, config, sendId: started.id })
      } catch (error) {
        const message = error instanceof RestartRefused ? error.message : error instanceof Error ? error.message : 'the server said no'
        setLine(key, { kind: 'error', message: `Couldn’t send · ${message.replace(/\.$/, '')}`, retry: 'taildrop', target })
      }
    },

    cancel(key) {
      const job = running.get(key)

      if (job?.abort) {
        job.abort.abort()
      }

      if (job?.sendId) {
        void cancelTaildropSend(job.config, job.sendId).catch(() => undefined)
      }

      stop(key)
      setLine(key, { kind: 'idle' })
    },

    clear(key) {
      setLine(key, { kind: 'idle' })
    },
  }
})
