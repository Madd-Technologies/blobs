import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, TextInput, View } from 'react-native'

import { SubRow } from '@/components/phone/SettingsParts'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import { usePhone } from '@/stores/phone'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/**
 * What a call never says without your tick. The values are write-only: they go to the server once and come back only as
 * their last two characters, so they are never stored on this phone or shown again.
 */
export default function NeverShare() {
  const { c } = useTheme()
  const settings = usePhone(state => state.settings)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void usePhone.getState().loadSettings()
  }, [])

  async function remove(entry: string) {
    const error = await usePhone.getState().saveSettings({ never_share_remove: [entry] })

    if (error) {
      toast(error)
    }
  }

  async function add() {
    setBusy(true)
    const error = await usePhone.getState().saveSettings({ never_share_add: [{ label: label.trim(), value: value.trim() }] })
    setBusy(false)

    if (error) {
      toast(error)

      return
    }

    close()
  }

  // Nothing of the value stays on the phone once the sheet is gone, saved or not.
  function close() {
    setAdding(false)
    setLabel('')
    setValue('')
  }

  const entries = settings?.never_share ?? []

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="Never share" />
      <ScrollView contentContainerStyle={styles.body}>
        <T variant="secondary" color="text2" style={styles.intro}>
          A brief that holds one of these waits for your tick before any call. The values stay on your server; here you only see their last two characters.
        </T>
        <GroupedList>
          {entries.map(entry => (
            <Row key={entry.label} label={entry.label} value={entry.hint} right={<IconCircle icon="minus" label={`Remove ${entry.label}`} bare diameter={32} onPress={() => void remove(entry.label)} />} />
          ))}
          <SubRow label="Add" lead={<Feather name="plus" size={18} color={c.text} />} chevron={false} onPress={() => setAdding(true)} />
        </GroupedList>
      </ScrollView>

      <Sheet visible={adding} onClose={close} label="Add to never share" avoidKeyboard>
        <View style={styles.sheet}>
          <T variant="sheetTitle">Add to never share</T>
          <View style={styles.field}>
            <T variant="label" color="text2">
              What it is
            </T>
            <TextInput value={label} onChangeText={setLabel} placeholder="Work address" placeholderTextColor={c.text2} maxLength={40} autoFocus accessibilityLabel="What it is" style={[styles.input, { backgroundColor: c.pressedIn, color: c.text }]} />
          </View>
          <View style={styles.field}>
            <T variant="label" color="text2">
              The value
            </T>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="22 Birch Court"
              placeholderTextColor={c.text2}
              maxLength={200}
              autoCorrect={false}
              // Keep it out of autofill, suggestions and the keyboard's learning.
              autoComplete="off"
              importantForAutofill="no"
              accessibilityLabel="The value"
              style={[styles.input, { backgroundColor: c.pressedIn, color: c.text }]}
            />
          </View>
          <T variant="label" color="text2">
            Saved to your server. After this you’ll see only {value.trim() ? `“…${value.trim().slice(-2)}”` : 'its last two characters'}, and any brief that holds it needs your tick.
          </T>
          <Pill label="Add" variant="primary" height={52} disabled={!label.trim() || !value.trim()} loading={busy} onPress={() => void add()} />
        </View>
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
  intro: { marginHorizontal: 4, marginBottom: 18 },
  sheet: { gap: 16, paddingBottom: 16 },
  field: { gap: 6 },
  input: { height: 48, borderRadius: radius.field, paddingHorizontal: 14, fontFamily: fonts.regular, fontSize: 16 },
})
