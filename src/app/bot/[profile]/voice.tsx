import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { BotPaper } from '@/components/bots/BotPaper'
import { GroupedList, Row } from '@/components/ui/GroupedList'
import { Screen } from '@/components/ui/Screen'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { Sheet } from '@/components/ui/Sheet'
import { Spinner } from '@/components/ui/Spinner'
import { Switch } from '@/components/ui/Switch'
import { T } from '@/components/ui/T'
import { accountHint, accountLabel, PRIVACY_NOTE, VOICES, voiceLabel, type VoiceAccount, type VoiceChange } from '@/lib/hermes/voice'
import { useBotView } from '@/stores/bots'
import { useConnection } from '@/stores/connection'
import { toast } from '@/stores/toast'
import { useVoice } from '@/stores/voice'

const ACCOUNTS: VoiceAccount[] = ['sign-in', 'key']

/** A bot's voice calls (the hermes-voice plugin): on or off, the voice it speaks with, and which xAI account pays. */
export default function BotVoice() {
  const { profile } = useLocalSearchParams<{ profile: string }>()
  const online = useConnection(state => state.status === 'online')
  const entry = useVoice(state => state.byBot[profile])
  const name = useBotView(profile)?.name ?? profile
  const [choosing, setChoosing] = useState<'voice' | 'account' | null>(null)

  useEffect(() => {
    if (online) {
      void useVoice.getState().load(profile)
    }
  }, [online, profile])

  async function change(next: VoiceChange) {
    setChoosing(null)
    const error = await useVoice.getState().change(profile, next)

    if (error) {
      toast(error)
    }
  }

  const voice = entry?.voice

  return (
    <BotPaper profile={profile}>
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title="Voice" />
        {!entry ? (
          <View style={styles.center}>
            <Spinner size={16} />
          </View>
        ) : !voice ? (
          <View style={styles.center}>
            <T variant="secondary" color="text2" style={styles.message} selectable>
              {entry.error ?? 'Voice calls need the hermes-voice plugin on your server. Add it from Settings, Server plugins.'}
            </T>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <GroupedList radius={20}>
              <Row label="Calls" right={<Switch value={voice.enabled} onValueChange={enabled => void change({ enabled })} label="Calls" />} />
            </GroupedList>

            <GroupedList radius={20}>
              <Row label="Voice" value={voiceLabel(voice.voice)} onPress={() => setChoosing('voice')} />
              <Row label="Account" value={accountLabel(voice.account)} onPress={() => setChoosing('account')} />
            </GroupedList>
            <T variant="label" color="text2" style={styles.note}>
              {accountHint(voice.account, voice)}
            </T>

            <T variant="label" color="text2" style={styles.note}>
              {`On a call, ${name} hands real work to its chat and reads you the answer. Approvals and questions wait for a tap on your screen. ${PRIVACY_NOTE}`}
            </T>
          </ScrollView>
        )}

        <Sheet visible={choosing === 'voice'} onClose={() => setChoosing(null)} label="Voice">
          <GroupedList>
            {VOICES.map(option => (
              <Row key={option.value} label={option.label} value={option.value === voice?.voice ? 'Selected' : undefined} chevron={false} onPress={() => void change({ voice: option.value })} />
            ))}
          </GroupedList>
        </Sheet>

        <Sheet visible={choosing === 'account'} onClose={() => setChoosing(null)} label="Account">
          <GroupedList>
            {ACCOUNTS.map(account => (
              <Row key={account} label={accountLabel(account)} value={account === voice?.account ? 'Selected' : undefined} chevron={false} onPress={() => void change({ account })} />
            ))}
          </GroupedList>
          {voice ? (
            <T variant="label" color="text2" style={styles.hints}>
              {ACCOUNTS.map(account => `${accountLabel(account)}: ${accountHint(account, voice)}`).join('\n')}
            </T>
          ) : null}
        </Sheet>
      </Screen>
    </BotPaper>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  center: { flex: 1, alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  message: { textAlign: 'center', paddingTop: 40 },
  note: { paddingHorizontal: 8, textAlign: 'center' },
  hints: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
})
