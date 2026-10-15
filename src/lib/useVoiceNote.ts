import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { readAsStringAsync } from 'expo-file-system/legacy'
import { useCallback, useEffect, useState } from 'react'

import { describeError } from '@/features/sessions/store'
import { transcribeRecording } from '@/lib/hermes/audio'
import { useConnection } from '@/stores/connection'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

/** Shorter than this and the tap was a slip, not a message. */
const MIN_SECONDS = 0.6

export type VoiceResult = { text: string } | { error: string }

/**
 * Record a voice message and turn it into text on the server. `start` returns an error to show (no permission, no
 * microphone) or null; `finish` stops, uploads and returns the words (empty when nothing was heard).
 */
export function useVoiceNote(profile?: string) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const status = useAudioRecorderState(recorder, 250)
  const [state, setState] = useState<VoiceState>('idle')

  // Leaving the screen mid-recording lets the microphone go.
  useEffect(
    () => () => {
      void recorder.stop().catch(() => undefined)
    },
    [recorder],
  )

  const start = useCallback(async (): Promise<string | null> => {
    try {
      const permission = await requestRecordingPermissionsAsync()

      if (!permission.granted) {
        return 'Microphone access is off. Turn it on in Settings to record.'
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setState('recording')

      return null
    } catch (error) {
      setState('idle')

      return describeError(error)
    }
  }, [recorder])

  const finish = useCallback(async (): Promise<VoiceResult> => {
    const seconds = status.durationMillis / 1000
    setState('transcribing')

    try {
      await recorder.stop()
      await setAudioModeAsync({ allowsRecording: false })
      const uri = recorder.uri
      const config = useConnection.getState().config

      if (!uri || seconds < MIN_SECONDS) {
        return { text: '' }
      }

      if (!config) {
        return { error: 'Not connected to the server.' }
      }

      const base64 = await readAsStringAsync(uri, { encoding: 'base64' })

      return { text: (await transcribeRecording(config, base64, { profile })).text }
    } catch (error) {
      return { error: describeError(error) }
    } finally {
      setState('idle')
    }
  }, [recorder, status.durationMillis, profile])

  const cancel = useCallback(async () => {
    setState('idle')
    await recorder.stop().catch(() => undefined)
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
  }, [recorder])

  return { state, seconds: state === 'recording' ? status.durationMillis / 1000 : 0, start, finish, cancel }
}
