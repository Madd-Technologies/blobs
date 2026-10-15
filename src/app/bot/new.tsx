import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { BotFace } from '@/components/bots/BotFace'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { T } from '@/components/ui/T'
import { BOT_NAME, slugifyName } from '@/lib/hermes/profiles'
import { makeBot } from '@/stores/profiles'
import { useRoster } from '@/stores/roster'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** Makes a new bot: a copy of your default one (same skills, same sign-ins) with its own name and instructions. */
export default function NewBot() {
  const router = useRouter()
  const { c } = useTheme()
  // Select the stable list, not a fresh array: a selector that returns a new value each time re-renders forever.
  const rows = useRoster(state => state.rows)
  const taken = useMemo(() => rows.map(row => row.name), [rows])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [soul, setSoul] = useState('')
  // `undefined` follows the name; once the person edits the profile name it is theirs.
  const [custom, setCustom] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const name = custom ?? slugifyName(title)
  const found = !name ? null : !BOT_NAME.test(name) ? 'Use lowercase letters, numbers, - and _, starting with a letter or number.' : taken.includes(name) ? `There is already a bot called ${name}.` : null
  // Once Create is pressed the new bot is in the roster, which must not read as a clash with itself.
  const problem = busy ? null : found
  const ready = title.trim().length > 0 && !!name && !problem

  async function create() {
    setBusy(true)
    const error = await makeBot({ title: title.trim(), name, description, soul })
    setBusy(false)

    if (error) {
      toast(error)

      return
    }

    // Replace, so Back from the new bot's chat returns to the list rather than to this form.
    router.replace({ pathname: '/bot/[profile]', params: { profile: name } })
  }

  const field = [styles.field, { backgroundColor: c.sheet, color: c.text }]

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconCircle icon="chevron-left" label="Back" bare diameter={40} onPress={() => router.back()} />
        <T variant="heading" style={styles.title} accessibilityRole="header">
          New bot
        </T>
      </View>

      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <BotFace name={name || 'new'} meta={{ shape: 'blobatar', title }} size={72} />
          </View>

          <View style={styles.group}>
            <T variant="label" color="text2">
              Name
            </T>
            <TextInput value={title} onChangeText={setTitle} placeholder="Date night planner" placeholderTextColor={c.text2} autoFocus autoCapitalize="words" accessibilityLabel="Name" style={field} />
          </View>

          <View style={styles.group}>
            <T variant="label" color="text2">
              Description
            </T>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What is it for?"
              placeholderTextColor={c.text2}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Description"
              style={[field, styles.multi]}
            />
          </View>

          <View style={styles.group}>
            <T variant="label" color="text2">
              Instructions (optional)
            </T>
            <TextInput
              value={soul}
              onChangeText={setSoul}
              placeholder="How should it behave?"
              placeholderTextColor={c.text2}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Instructions"
              style={[field, styles.multi, styles.tall]}
            />
          </View>

          <View style={styles.group}>
            <T variant="label" color="text2">
              Profile name
            </T>
            <TextInput
              value={name}
              onChangeText={text => setCustom(text.toLowerCase())}
              placeholder="date-night"
              placeholderTextColor={c.text2}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Profile name"
              style={[field, { fontFamily: fonts.mono, fontSize: 14 }]}
            />
            <T variant="label" color={problem ? 'danger' : 'text2'}>
              {problem ?? 'How the server knows it. It cannot be changed later.'}
            </T>
          </View>

          <Pill label="Create bot" variant="primary" height={52} onPress={() => void create()} disabled={!ready} loading={busy} style={styles.create} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 16, paddingTop: 8, paddingBottom: 10 },
  title: { flex: 1 },
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 16 },
  hero: { alignItems: 'center', paddingVertical: 8 },
  group: { gap: 6 },
  field: { borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 14, fontFamily: fonts.regular, fontSize: 16 },
  multi: { minHeight: 84 },
  tall: { minHeight: 140 },
  create: { marginTop: 8 },
})
