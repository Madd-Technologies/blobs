import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { T } from '@/components/ui/T'
import type { ListenSnapshot } from '@/features/phone/listen'
import type { ShownLine } from '@/features/phone/view'
import { haptic } from '@/lib/haptics'
import { useListen } from '@/stores/listen'
import { useTheme } from '@/theme/ThemeProvider'
import { fonts, radius } from '@/theme/tokens'

interface TrayProps {
  /** Your listen session on this call, if any. */
  snap: ListenSnapshot | null
  /** Whether this phone and server can listen in at all. */
  canListen: boolean
  /** A card waits for you: its answer takes the white pill. */
  quiet: boolean
  onListen: () => void
  onJoin: () => void
  onHangUp: () => void
}

/**
 * The live call's raised tray. Before you listen: Listen in and Join. While you listen: Take over, the speaker and Stop. While you
 * have the line: Hand back (with an optional note for the voice), mute and the speaker. Hang up is always there.
 */
export function LiveTray({ snap, canListen, quiet, onListen, onJoin, onHangUp }: TrayProps) {
  const insets = useSafeAreaInsets()
  const speaker = useListen(state => state.speaker)
  const [handing, setHanding] = useState(false)
  const listening = !!snap && snap.phase !== 'ended'
  const owner = listening && snap.mode === 'owner'
  const joining = listening && (snap.joining || snap.mode === 'handover')
  const primary = quiet ? 'secondary' : 'primary'

  let actions
  if (!canListen) {
    actions = <Pill label="Hang up" icon="phone-off" variant={primary} onPress={onHangUp} flex height={52} />
  } else if (!listening) {
    actions = (
      <>
        <Pill label="Listen in" icon="headphones" variant={primary} onPress={onListen} flex height={52} />
        <Pill label="Join" icon="phone" onPress={onJoin} flex height={52} />
        <Pill label="Hang up" icon="phone-off" onPress={onHangUp} height={52} accessibilityLabel="Hang up the call" />
      </>
    )
  } else if (owner) {
    actions = (
      <>
        <Pill label={snap.muted ? 'Unmute' : 'Mute'} icon={snap.muted ? 'mic-off' : 'mic'} onPress={() => useListen.getState().setMuted(!snap.muted)} flex height={52} />
        <Pill label={speaker ? 'Speaker' : 'Earpiece'} icon={speaker ? 'volume-2' : 'phone'} onPress={() => useListen.getState().setSpeaker(!speaker)} flex height={52} />
        <Pill label="Hand back" icon="corner-up-left" variant={primary} onPress={() => setHanding(true)} flex height={52} />
      </>
    )
  } else {
    actions = (
      <>
        <Pill label={speaker ? 'Speaker' : 'Earpiece'} icon={speaker ? 'volume-2' : 'phone'} onPress={() => useListen.getState().setSpeaker(!speaker)} flex height={52} />
        <Pill label="Stop" icon="x" onPress={() => useListen.getState().leave()} flex height={52} />
        <Pill
          label={joining ? 'Putting you on' : 'Take over'}
          icon={joining ? undefined : 'mic'}
          loading={joining || snap.phase === 'connecting'}
          variant={primary}
          onPress={() => {
            haptic('confirm')
            useListen.getState().takeOver()
          }}
          flex
          height={52}
        />
      </>
    )
  }

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <Raised radius={radius.tray}>
        <View style={styles.actions}>{actions}</View>
      </Raised>
      <HandBackSheet visible={handing} onClose={() => setHanding(false)} />
    </View>
  )
}

/** Handing the call back: an optional note the voice acts on (checked like an answer), then the voice carries on. */
function HandBackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme()
  const [note, setNote] = useState('')

  const hand = () => {
    haptic('confirm')
    useListen.getState().handBack(note)
    setNote('')
    onClose()
  }

  return (
    <Sheet visible={visible} onClose={onClose} label="Hand the call back" avoidKeyboard>
      <View style={styles.sheet}>
        <T variant="heading">Hand the call back</T>
        <T variant="secondary" color="text2">
          The voice hears what was said while you were on, as information. Anything it should act on goes in your note.
        </T>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note for the voice (optional)"
          placeholderTextColor={c.text2}
          accessibilityLabel="Note for the voice"
          multiline
          maxLength={300}
          style={[styles.note, { backgroundColor: c.pressedIn, color: c.text }]}
        />
        <Pill label="Hand back" variant="primary" height={48} onPress={hand} />
      </View>
    </Sheet>
  )
}

/** The newest lines of a live call, as they come (from the listen socket while you listen, else as last saved). */
export function LiveLines({ lines }: { lines: ShownLine[] }) {
  const { c } = useTheme()

  if (!lines.length) {
    return null
  }

  return (
    <View style={[styles.lines, { backgroundColor: c.sheet }]}>
      {lines.map((entry, index) =>
        entry.kind === 'quiet' ? (
          <T key={index} variant="label" color="text2" style={styles.tabular}>
            {entry.at} · {entry.text}
          </T>
        ) : (
          <View key={index} style={styles.tight}>
            <T variant="meta" color="text2" style={styles.tabular}>
              <T variant="meta" color={entry.kind === 'them' ? 'text' : 'text2'} style={styles.semibold}>
                {entry.who}
              </T>
              {' · '}
              {entry.at}
            </T>
            <T variant="body" style={styles.loose}>
              {entry.text}
            </T>
          </View>
        ),
      )}
    </View>
  )
}

/** One quiet line under the call's title: who has the line, with the spinner while you're being put on. */
export function LiveStatus({ text, busy }: { text: string; busy: boolean }) {
  return (
    <View style={styles.status}>
      {busy ? <Spinner size={12} /> : null}
      <T variant="secondary" color="text2" style={styles.flex}>
        {text}
      </T>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  footer: { paddingHorizontal: 12, paddingTop: 8 },
  actions: { flexDirection: 'row', gap: 8, padding: 8 },
  sheet: { gap: 12, paddingBottom: 8 },
  note: { minHeight: 88, borderRadius: radius.field, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontFamily: fonts.regular, fontSize: 15, textAlignVertical: 'top' },
  lines: { borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  tight: { gap: 2 },
  loose: { lineHeight: 22 },
  semibold: { fontFamily: fonts.semibold },
  tabular: { fontVariant: ['tabular-nums'] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
})
