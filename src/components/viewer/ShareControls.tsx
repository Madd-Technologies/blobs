import Feather from '@expo/vector-icons/Feather'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'

import { GroupedList } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { deviceRows, progressLabel, sizeLabel, splitStale, type DeviceRow } from '@/features/share/model'
import { useConnection } from '@/stores/connection'
import type { ViewerDoc } from '@/stores/documents'
import { useLastTarget, useShare, type ShareLine } from '@/stores/share'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'

/** The server's short name for the sheet's title: a host name's first part, else "your server" for an address. */
function serverName(baseUrl: string | undefined): string {
  const host = (baseUrl ?? '').replace(/^https?:\/\//i, '').replace(/[:/].*$/, '')

  return !host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' ? 'your server' : (host.split('.')[0] ?? host)
}

/** What the viewer's header holds for sharing: its buttons, or a line in their place, and how wide the buttons are. */
export function useShareHeader(key: string | undefined, doc: ViewerDoc | null): { right: ReactNode; line: ReactNode; sideWidth: number } {
  const taildrop = useShare(state => state.taildrop)
  const line = useShare(state => (key ? state.lines[key] : undefined)) ?? { kind: 'idle' }
  const online = useConnection(state => state.status === 'online')

  useEffect(() => {
    if (online && doc?.kind === 'file') {
      void useShare.getState().loadTaildrop()
    }
  }, [online, doc?.kind])

  if (!key || !doc) {
    return { right: null, line: null, sideWidth: 40 }
  }

  if (line.kind !== 'idle' && !(line.kind === 'getting' && !line.visible)) {
    return { right: null, line: <LineView docKey={key} doc={doc} line={line} />, sideWidth: 40 }
  }

  // Taildrop only for a file on the server (not a Paperless or Drive document yet, nor a change), where it works.
  const send = doc.kind === 'file' && !!taildrop?.supported
  const buttons = (
    <View style={styles.buttons}>
      {send ? <IconCircle icon="send" label="Taildrop from the server" diameter={40} onPress={() => useShare.getState().openSheet(key)} /> : null}
      <IconCircle icon="share" label="Share from this phone" diameter={40} onPress={() => void useShare.getState().share(key, doc)} />
    </View>
  )

  return { right: buttons, line: null, sideWidth: send ? 88 : 40 }
}

/** The quiet line in the buttons' place: getting it ready, sending, or what went wrong, with Cancel or Try again. */
function LineView({ docKey, doc, line }: { docKey: string; doc: ViewerDoc; line: Exclude<ShareLine, { kind: 'idle' }> }) {
  if (line.kind === 'error') {
    const retry = () => {
      useShare.getState().clear(docKey)

      if (line.retry === 'share') {
        void useShare.getState().share(docKey, doc)
      } else if (line.target) {
        void useShare.getState().send(docKey, doc, line.target)
      }
    }

    return (
      // A tap anywhere else on the line brings the buttons back; nothing here needs you.
      <Pressable accessibilityRole="button" accessibilityLabel={`${line.message}. Try again`} onPress={() => useShare.getState().clear(docKey)} style={styles.lineColumn}>
        <T variant="label" color="text2" numberOfLines={1} style={styles.centered}>
          {line.message}
        </T>
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" hitSlop={8} onPress={retry}>
          <T variant="label" style={styles.bold}>
            Try again
          </T>
        </Pressable>
      </Pressable>
    )
  }

  const words = line.kind === 'getting' ? `Getting it ready · ${progressLabel(line.done, line.total)}` : `Sending to ${line.target.you ? 'this phone' : line.target.name} · ${progressLabel(line.sent, line.total)}`

  return (
    <View style={styles.lineRow} accessibilityLiveRegion="polite">
      <Spinner size={12} />
      <T variant="label" color="text2" numberOfLines={1} style={styles.shrink}>
        {words}
      </T>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10} onPress={() => useShare.getState().cancel(docKey)}>
        <T variant="label" style={styles.bold}>
          Cancel
        </T>
      </Pressable>
    </View>
  )
}

/** Taildrop from the server: the devices it can send to, this phone first (canvas row 25). */
export function TaildropSheet({ docKey, doc, size }: { docKey: string | undefined; doc: ViewerDoc | null; size?: number }) {
  const { c } = useTheme()
  const open = useShare(state => !!docKey && state.sheetFor === docKey)
  const taildrop = useShare(state => state.taildrop)
  const baseUrl = useConnection(state => state.config?.baseUrl)
  const lastTarget = useLastTarget(state => (baseUrl ? (state.byServer[baseUrl] ?? null) : null))
  const [showStale, setShowStale] = useState(false)
  const { height } = useWindowDimensions()

  if (!docKey || !doc) {
    return null
  }

  const rows = taildrop ? deviceRows(taildrop, lastTarget) : []
  // A tailnet keeps devices for years: those offline for over a week wait behind one row.
  const { shown, stale } = splitStale(rows)
  const listed = showStale ? [...shown, ...stale] : shown
  const setup = taildrop?.setup
  const device = (row: DeviceRow) => (
    <Pressable
      key={row.target.ip || row.target.name}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}${row.line ? `, ${row.line}` : ''}`}
      accessibilityState={{ disabled: row.disabled }}
      disabled={row.disabled}
      onPress={() => void useShare.getState().send(docKey, doc, row.target)}
      style={({ pressed }) => [styles.device, { backgroundColor: pressed ? c.tone : 'transparent', opacity: row.disabled ? 0.4 : 1 }]}
    >
      <Feather name={row.icon} size={18} color={c.text2} />
      <View style={styles.flex}>
        <T variant="body" numberOfLines={1}>
          {row.title}
        </T>
        {row.line ? (
          <T variant="label" color="text2" numberOfLines={1}>
            {row.line}
          </T>
        ) : null}
      </View>
    </Pressable>
  )

  return (
    <Sheet visible={open} onClose={() => useShare.getState().closeSheet()} label="Taildrop from the server">
      <View style={styles.body}>
        {setup ? (
          <>
            <T variant="heading">Taildrop needs one setup step on the server</T>
            <T variant="label" color="text2">
              Hermes runs as {setup.user}, and Tailscale doesn’t let it send files yet. Run this once where Hermes runs:
            </T>
            <View style={[styles.command, { backgroundColor: c.tone }]}>
              <T variant="mono" style={styles.flex} selectable>
                {setup.command}
              </T>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy the command"
                onPress={() => {
                  void Clipboard.setStringAsync(setup.command)
                  toast('Copied')
                }}
                style={styles.copy}
              >
                <Feather name="copy" size={14} color={c.text} />
                <T variant="label">Copy</T>
              </Pressable>
            </View>
            <T variant="label" color="text2">
              Then tap a device again. Until then, Share from this phone still works.
            </T>
          </>
        ) : (
          <View style={styles.head}>
            <T variant="heading">Taildrop from {serverName(baseUrl)}</T>
            <T variant="label" color="text2">
              {doc.name}
              {size ? ` · ${sizeLabel(size)}` : ''}. The server sends it, so it never passes through this phone.
            </T>
          </View>
        )}

        {taildrop === undefined ? (
          <View style={styles.loading}>
            <Spinner size={16} />
          </View>
        ) : rows.length ? (
          <ScrollView style={{ maxHeight: height * 0.5 }} showsVerticalScrollIndicator={false}>
            <GroupedList>
              {listed.map(device)}
              {stale.length && !showStale ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${stale.length} more, offline for over a week`}
                  onPress={() => setShowStale(true)}
                  style={({ pressed }) => [styles.device, { backgroundColor: pressed ? c.tone : 'transparent' }]}
                >
                  <Feather name="more-horizontal" size={18} color={c.text2} />
                  <T variant="label" color="text2" style={styles.flex}>
                    {stale.length} more, offline for over a week
                  </T>
                </Pressable>
              ) : null}
            </GroupedList>
          </ScrollView>
        ) : (
          <T variant="label" color="text2">
            {taildrop?.why ?? 'Taildrop has no other devices to send to.'}
          </T>
        )}

        {rows.length && !setup ? (
          <T variant="label" color="text2">
            A tap sends it. It arrives in Tailscale’s notification on that device.
          </T>
        ) : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  lineColumn: { alignItems: 'center' },
  centered: { textAlign: 'center' },
  bold: { fontFamily: 'Geist_600SemiBold' },
  shrink: { flexShrink: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { gap: 14, paddingBottom: 8 },
  head: { gap: 4 },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  device: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 14 },
  command: { borderRadius: 12, paddingLeft: 12, paddingRight: 6, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
})
