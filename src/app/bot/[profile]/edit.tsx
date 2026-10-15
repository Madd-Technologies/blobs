import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, StyleSheet, TextInput, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import { useBotView } from '@/stores/bots'
import { saveBotMeta, saveDescription, saveInstructions, useProfileDetail } from '@/stores/profiles'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

type Field = 'title' | 'description' | 'soul'

const COPY: Record<Field, { title: string; hint: string; multiline: boolean }> = {
  title: { title: 'Name', hint: 'The name shown in your list and chats. The profile name on the server does not change.', multiline: false },
  description: { title: 'Description', hint: 'What this bot is for, in a line or two. It shows under the name.', multiline: true },
  soul: { title: 'Instructions', hint: 'Standing instructions the bot follows in every chat (its SOUL.md).', multiline: true },
}

/** One text setting of a bot, edited full screen: name, description or instructions. */
export default function EditBot() {
  const { profile, field } = useLocalSearchParams<{ profile: string; field: Field }>()
  const router = useRouter()
  const { c } = useTheme()
  const view = useBotView(profile)
  const detail = useProfileDetail(state => state.byBot[profile]?.detail ?? null)
  const copy = COPY[field] ?? COPY.title
  // `undefined` until the person types: the field then shows the saved value, and nothing needs copying into state.
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  const saved = field === 'soul' ? (detail?.soul ?? null) : field === 'description' ? (detail?.description ?? view?.row.description ?? '') : (view?.name ?? profile)

  useEffect(() => {
    if (field === 'soul' && !detail) {
      void useProfileDetail.getState().load(profile)
    }
  }, [field, detail, profile])

  const text = draft ?? saved ?? ''
  const changed = draft !== undefined && draft !== (saved ?? '')
  const valid = field !== 'title' || text.trim().length > 0

  async function save() {
    setSaving(true)
    const error = field === 'title' ? await saveBotMeta(profile, { title: text.trim() }) : field === 'description' ? await saveDescription(profile, text.trim()) : await saveInstructions(profile, text)
    setSaving(false)

    if (error) {
      toast(error)

      return
    }

    router.back()
  }

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => router.back()} />
          <T variant="heading" style={styles.title} numberOfLines={1} accessibilityRole="header">
            {copy.title}
          </T>
          <Pill label="Save" variant="primary" height={40} onPress={() => void save()} disabled={!changed || !valid} loading={saving} />
        </View>

        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          {saved === null ? (
            <View style={styles.center}>
              <Spinner size={16} />
            </View>
          ) : (
            <View style={styles.body}>
              <TextInput
                value={text}
                onChangeText={setDraft}
                multiline={copy.multiline}
                autoFocus
                autoCapitalize={field === 'soul' ? 'sentences' : 'words'}
                placeholder={copy.title}
                placeholderTextColor={c.text2}
                accessibilityLabel={copy.title}
                textAlignVertical="top"
                style={[styles.field, copy.multiline && (field === 'soul' ? styles.tall : styles.short), { backgroundColor: c.sheet, color: c.text }, field === 'soul' && { fontFamily: fonts.mono, fontSize: 14, lineHeight: 21 }]}
              />
              <T variant="label" color="text2" style={styles.hint}>
                {copy.hint}
              </T>
            </View>
          )}
        </KeyboardAvoidingView>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  field: { borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  tall: { flex: 1, minHeight: 140 },
  short: { minHeight: 120 },
  hint: { paddingHorizontal: 4 },
})
