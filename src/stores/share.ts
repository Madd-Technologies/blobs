import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { getFailure, sendFailure, sentToast } from '@/features/share/model'
import { HermesHttpError, restHeaders, type ServerConfig } from '@/lib/hermes/server'
import { RestartRefused } from '@/lib/hermes/restart'
import { cancelTaildropSend, getTaildrop, getTaildropSend, sendTaildrop, type TaildropStatus, type TaildropTarget } from '@/lib/hermes/taildrop'
import { useConnection } from '@/stores/connection'
import type { ViewerDoc } from '@/stores/documents'
import { toast } from '@/stores/toast'

/** A share line under the viewer's title, while something is under way or went wrong. */
export type ShareLine =
  | { kind: 'idle' }
  /** Downloading for share from this phone; the line shows only past half a second. */
  | { kind: 'getting'; done: number; total: number | null; visible: boolean }
  | { kind: 'sending'; id: string; target: TaildropTarget; sent: number | null; total: number | null }
  | { kind: 'error'; message: string; retry: 'share' | 'taildrop'; target?: TaildropTarget }

interface ShareState {
  /** The server's Taildrop status: undefined until read, null without the route. */
  taildrop: TaildropStatus | null | undefined
  /** Each viewer screen's line, by its document key. */
  lines: Record<string, ShareLine>
  /** The device sheet, for one viewer screen. */
  sheetFor: string | null
  loadTaildrop: () => Promise<void>
  openSheet: (key: string) => void
  closeSheet: () => void
  share: (key: string, doc: ViewerDoc) => Promise<void>
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

export const useShare = create<ShareState>((set, get) => {
  const setLine = (key: string, line: ShareLine) => set(state => ({ lines: { ...state.lines, [key]: line } }))
  const stop = (key: string) => {
    const job = running.get(key)

    if (job?.poll) {
      clearInterval(job.poll)
    }

    running.delete(key)
  }

  return {
    taildrop: undefined,
    lines: {},
    sheetFor: null,

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

    async share(key, doc) {
      const config = useConnection.getState().config

      if (!config || running.has(key)) {
        return
      }

      try {
        if (doc.kind === 'diff') {
          // A change is made on the phone, as a .patch file.
          const file = new File(shareFolder(), `${safeName(doc.name)}.patch`)
          file.write(doc.diff)
          setLine(key, { kind: 'idle' })
          await Sharing.shareAsync(file.uri, { mimeType: 'text/x-diff', dialogTitle: doc.name })

          return
        }

        const url = downloadUrl(config, doc)

        if (!url) {
          return
        }

        const abort = new AbortController()
        running.set(key, { abort, config })
        setLine(key, { kind: 'getting', done: 0, total: null, visible: false })
        // Ready within half a second: no line at all.
        const reveal = setTimeout(() => {
          const line = get().lines[key]

          if (line?.kind === 'getting') {
            setLine(key, { ...line, visible: true })
          }
        }, 500)
        const task = File.createDownloadTask(url, new File(shareFolder(), safeName(doc.name)), {
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

        if (!file) {
          setLine(key, { kind: 'idle' })

          return
        }

        setLine(key, { kind: 'idle' })
        await Sharing.shareAsync(file.uri, { dialogTitle: doc.name })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setLine(key, { kind: 'idle' })

          return
        }

        const status = error instanceof HermesHttpError ? error.status : (Number(/\b([45]\d\d)\b/.exec(String(error))?.[1]) || null)
        setLine(key, { kind: 'error', message: `Couldn’t get the file · ${getFailure(status)}`, retry: 'share' })
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
