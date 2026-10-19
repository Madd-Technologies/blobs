import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BotFace } from '@/components/bots/BotFace'
import { IconCircle } from '@/components/ui/IconCircle'
import { Pill } from '@/components/ui/Pill'
import { Press } from '@/components/ui/Press'
import { Raised } from '@/components/ui/Raised'
import { T } from '@/components/ui/T'
import type { CallSnapshot } from '@/features/call/engine'
import { callStatus } from '@/features/call/view'
import { clock } from '@/lib/hermes/audio'
import type { BotMeta } from '@/lib/hermes/identity'
import { useNowMs } from '@/lib/useNow'
import { useFaceColor } from '@/stores/bots'
import { useCall } from '@/stores/call'
import { radius } from '@/theme/tokens'

import { CallRings } from './CallRings'

interface Props {
  profile: string
  botName: string
  meta?: BotMeta | null
  call: CallSnapshot
  /** A card in the chat waits for you: it has the white pill, so Hang up is pressed in. */
  waiting: boolean
  /** Back to the call screen. */
  onOpen: () => void
}

/**
 * The chat's tray while a call goes on behind it: the small face with its rings, where the call is and its clock, Mute and Hang
 * up. Tapping it brings the call screen back.
 */
export function CallBar({ profile, botName, meta, call, waiting, onOpen }: Props) {
  const insets = useSafeAreaInsets()
  const color = useFaceColor(profile)
  const level = useCall(state => state.level)
  const voiceLevel = useCall(state => state.voiceLevel)
  const since = useCall(state => state.since)
  const live = call.phase === 'live'
  const now = useNowMs(live)
  const seconds = live && since ? Math.max(0, Math.floor((now - since) / 1000)) : 0
  const status = callStatus(call, botName, waiting)
  const who = !live ? null : call.speaking === 'voice' ? 'voice' : call.speaking === 'you' && !call.muted ? 'you' : null

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <Raised radius={radius.tray}>
        <View style={styles.row}>
          <Press accessibilityRole="button" accessibilityLabel={`Back to the call with ${botName}`} disabled={call.phase === 'ended'} onPress={onOpen} style={styles.open}>
            <CallRings who={who} level={who === 'voice' ? voiceLevel : level} color={color} size={22}>
              <BotFace name={profile} meta={meta} size={22} />
            </CallRings>
            <View style={styles.words}>
              <T variant="bodyMedium" numberOfLines={1}>
                {status.text}
              </T>
              {call.phase !== 'ended' ? (
                <T variant="status" color="text2" style={styles.clock}>
                  {live ? `Call · ${clock(seconds)}` : 'Voice call'}
                </T>
              ) : null}
            </View>
          </Press>
          <IconCircle icon={call.muted ? 'mic-off' : 'mic'} label={call.muted ? 'Unmute' : 'Mute'} diameter={44} disabled={!live} onPress={() => useCall.getState().setMuted(!call.muted)} />
          <Pill label="Hang up" icon="phone-off" variant={waiting ? 'secondary' : 'primary'} height={44} disabled={call.phase === 'ended'} onPress={() => useCall.getState().hangUp()} />
        </View>
      </Raised>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: 12, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  open: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4 },
  words: { flex: 1, minWidth: 0 },
  clock: { fontVariant: ['tabular-nums'] },
})
