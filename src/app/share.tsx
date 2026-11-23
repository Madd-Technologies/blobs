import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { GroupedList } from '@/components/ui/GroupedList'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { formatSharedDraft, normalizeSharedPayload, type SharedPayload } from '@/features/share/inbox'
import type { PendingFile } from '@/lib/hermes/attachments'
import { consumePendingShare } from '@/lib/shareInbox'
import { useBotMetas, useBotViews } from '@/stores/bots'
import { useDrafts } from '@/stores/drafts'
import { sessions } from '@/stores/sessions'
import { toast } from '@/stores/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

function toPendingFiles(payload: SharedPayload): PendingFile[] {
  return payload.files.map((file, index) => {
    const mime = file.mime || 'application/octet-stream'
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? 'pdf'
        : 'file'

    return {
      id: `share:${index}:${file.name}`,
      kind,
      name: file.name,
      mime,
      uri: file.uri,
    }
  })
}

/**
 * Target picker for OS Share Sheet handoffs (`hermesbot://share`).
 */
export default function ShareInboxScreen() {
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ text?: string; url?: string }>()
  const views = useBotViews({ includeHidden: true })
  const metas = useBotMetas()

  const [payload] = useState<SharedPayload | null>(() => {
    const fromNative = consumePendingShare()
    if (fromNative) return fromNative
    return normalizeSharedPayload({
      text: Array.isArray(params.text) ? params.text[0] : params.text,
      url: Array.isArray(params.url) ? params.url[0] : params.url,
      files: [],
    })
  })
  const [note, setNote] = useState('')
  const [sendNow, setSendNow] = useState(true)
  const [busyProfile, setBusyProfile] = useState<string | null>(null)

  async function pickBot(profile: string) {
    if (!payload || busyProfile) return

    const message = formatSharedDraft(payload, note)
    const files = toPendingFiles(payload)

    if (sendNow) {
      setBusyProfile(profile)
      const ok = await sessions.send(profile, message, files)
      setBusyProfile(null)

      if (!ok) {
        toast('Could not send right now; saved to draft instead')
        if (message) useDrafts.getState().set(profile, message)
      }
    } else if (message) {
      useDrafts.getState().set(profile, message)
    }

    router.replace({ pathname: '/bot/[profile]', params: { profile } })
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Send to bot" />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {payload ? (
          <>
            <Raised radius={radius.group} style={styles.previewCard}>
              <T variant="caption" color="text2">
                SHARED ITEM
              </T>
              {payload.text ? (
                <T variant="body" numberOfLines={4}>
                  {payload.text}
                </T>
              ) : null}
              {payload.url ? (
                <T variant="monoSmall" color="text2" numberOfLines={2}>
                  {payload.url}
                </T>
              ) : null}
              {payload.files.length > 0 ? (
                <T variant="secondary" color="text2">
                  {payload.files.map(file => file.name).join(', ')}
                </T>
              ) : null}
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add an optional instruction…"
                placeholderTextColor={c.text2}
                style={[styles.noteField, { backgroundColor: c.pressedIn, color: c.text }]}
              />
            </Raised>

            <GroupedList>
              <View style={styles.toggleRow}>
                <T variant="rowTitle" style={styles.flex}>
                  Send immediately
                </T>
                <Switch value={sendNow} onValueChange={setSendNow} label="Send immediately" />
              </View>
            </GroupedList>

            <T variant="meta" color="text2" style={styles.section}>
              Choose a bot
            </T>
            <GroupedList>
              {views.map((view, idx) => (
                <View key={view.profile}>
                  {idx > 0 ? <View style={[styles.sep, { backgroundColor: c.separator }]} /> : null}
                  <Press
                    accessibilityRole="button"
                    accessibilityLabel={`Send to ${view.name}`}
                    disabled={!!busyProfile}
                    onPress={() => void pickBot(view.profile)}
                    style={styles.botRow}
                  >
                    <BotFace name={view.profile} meta={metas[view.profile]} size={32} />
                    <View style={styles.flex}>
                      <T variant="rowTitle" numberOfLines={1}>
                        {view.name}
                      </T>
                      <T variant="label" color="text2" numberOfLines={1}>
                        {busyProfile === view.profile ? 'Sending…' : view.preview || 'Open chat'}
                      </T>
                    </View>
                  </Press>
                </View>
              ))}
            </GroupedList>
          </>
        ) : (
          <View style={styles.empty}>
            <T variant="heading">Nothing shared yet</T>
            <T variant="secondary" color="text2" style={styles.centered}>
              Share a link, photo, file, or note from another app and choose Blobs to hand it straight to a bot.
            </T>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 16 },
  previewCard: { padding: 16, gap: 8 },
  noteField: { height: 42, borderRadius: radius.field, paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 15, marginTop: 4 },
  toggleRow: { minHeight: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { paddingHorizontal: 4, marginBottom: -8 },
  sep: { height: 1, marginLeft: 60 },
  botRow: { minHeight: 58, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  empty: { paddingTop: 72, paddingHorizontal: 24, alignItems: 'center', gap: 6 },
  centered: { textAlign: 'center' },
})
