import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Pill } from '@/components/ui/Pill'
import { Raised } from '@/components/ui/Raised'
import type { CallSnapshot } from '@/features/call/engine'
import { useCall } from '@/stores/call'
import { radius } from '@/theme/tokens'

import { TalkButton } from './TalkButton'

interface Props {
  call: CallSnapshot
  /** A card waits for you: its answer takes the white pill, and Hang up is pressed in like the others. */
  quiet: boolean
  onHangUp: () => void
}

/**
 * The call screen's raised tray. An open line: Mute, Speaker and Hang up, three equal pills. Push to talk: Speaker, the wide
 * talk button (the white pill) and Hang up.
 */
export function CallControls({ call, quiet, onHangUp }: Props) {
  const insets = useSafeAreaInsets()
  const speaker = useCall(state => state.speaker)
  const live = call.phase === 'live'
  const speakerPill = <Pill label={speaker ? 'Speaker' : 'Earpiece'} icon={speaker ? 'volume-2' : 'phone'} disabled={!live} onPress={() => useCall.getState().setSpeaker(!speaker)} flex height={52} />

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <Raised radius={radius.tray}>
        {call.mode === 'walkie' ? (
          <View style={styles.actions}>
            {speakerPill}
            <TalkButton call={call} quiet={quiet} />
            <Pill label="Hang up" icon="phone-off" disabled={call.phase === 'ended'} onPress={onHangUp} flex height={52} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Pill label={call.muted ? 'Unmute' : 'Mute'} icon={call.muted ? 'mic-off' : 'mic'} disabled={!live} onPress={() => useCall.getState().setMuted(!call.muted)} flex height={52} />
            {speakerPill}
            <Pill label="Hang up" icon="phone-off" variant={quiet ? 'secondary' : 'primary'} disabled={call.phase === 'ended'} onPress={onHangUp} flex height={52} />
          </View>
        )}
      </Raised>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: 12, paddingTop: 8 },
  actions: { flexDirection: 'row', gap: 8, padding: 8 },
})
