import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'

import { Pill } from '@/components/ui/Pill'
import { Sheet } from '@/components/ui/Sheet'
import { T } from '@/components/ui/T'
import type { Errand } from '@/lib/hermes/phone'
import { usePhone } from '@/stores/phone'
import { sessions } from '@/stores/sessions'
import { toast } from '@/stores/toast'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

/** What the bot reads: your note, with the request it is about. */
export function redraftMessage(errand: Pick<Errand, 'brief'>, note: string): string {
  return `Please redraft the call request “${errand.brief.title}”: ${note.trim()}`
}

/**
 * Edit: the server has no way to change a brief after the bot wrote it (that is what keeps your approval meaningful), so
 * this withdraws the request and asks the bot, in the chat it came from, for a new one with your change.
 */
export function EditSheet({ errand, botName, visible, onClose }: { errand: Errand; botName: string; visible: boolean; onClose: () => void }) {
  const { c } = useTheme()
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    const declined = await usePhone.getState().decline(errand.id)

    if (declined) {
      setBusy(false)
      toast(declined)

      return
    }

    // Ask in the chat the request came from: the bot has its research there.
    await (errand.session_id ? sessions.openLinked(errand.profile, errand.session_id) : sessions.open(errand.profile)).catch(() => undefined)
    const sent = await sessions.send(errand.profile, redraftMessage(errand, note))
    setBusy(false)
    onClose()
    setNote('')

    if (!sent) {
      toast(`The request is withdrawn, but ${botName} didn’t get your note. Ask again in the chat.`)
    }

    router.navigate({ pathname: '/bot/[profile]', params: { profile: errand.profile, ...(errand.session_id ? { chat: errand.session_id } : {}) } })
  }

  return (
    <Sheet visible={visible} onClose={onClose} label={`What should ${botName} change?`} avoidKeyboard>
      <View style={styles.body}>
        <T variant="sheetTitle">What should {botName} change?</T>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Call only the first two, and say we’re flexible on the date."
          placeholderTextColor={c.text2}
          multiline
          autoFocus
          editable={!busy}
          accessibilityLabel={`What should ${botName} change?`}
          style={[styles.input, { backgroundColor: c.pressedIn, color: c.text }]}
        />
        <T variant="label" color="text2">
          This request is withdrawn and {botName} drafts a new one for your OK. Striking a fact or a call needs no new draft.
        </T>
        <Pill label={`Send to ${botName}`} variant="primary" height={52} disabled={!note.trim()} loading={busy} onPress={() => void send()} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: 14, paddingBottom: 16 },
  input: { minHeight: 120, maxHeight: 220, borderRadius: radius.field, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' },
})
