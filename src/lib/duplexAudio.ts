import { requireOptionalNativeModule } from 'expo'
import { requestRecordingPermissionsAsync } from 'expo-audio'

import type { CallAudio } from '@/features/call/engine'

type EventSubscription = { remove(): void }

interface DuplexAudio {
  start(): Promise<void>
  play(pcm: string): void
  flush(): void
  setSpeaker(on: boolean): void
  stop(): Promise<void>
  /** `level` is your microphone, `out` the voice as it plays (an older build sends no `out`). */
  addListener(event: 'onFrame', listener: (frame: { pcm: string; level: number; out?: number }) => void): EventSubscription
  addListener(event: 'onError', listener: (error: { message: string }) => void): EventSubscription
}

/** The local call-audio module (modules/duplex-audio): Android builds only for now. Absent on iOS and in Expo Go. */
const native = requireOptionalNativeModule<DuplexAudio>('DuplexAudio')

/** Whether this build can hold a call. */
export const canCall = (): boolean => !!native

/** The phone's call audio for one call: the engine's port, plus the speaker switch and the levels for the call screen's rings. */
export function callAudio(onLevel: (you: number, voice: number) => void, onError: (message: string) => void): CallAudio & { setSpeaker: (on: boolean) => void } {
  const subscriptions: EventSubscription[] = []

  return {
    async start(onFrame) {
      if (!native) {
        throw new Error('Calls need the Android app.')
      }

      const permission = await requestRecordingPermissionsAsync()

      if (!permission.granted) {
        throw new Error('Blobs needs the microphone for calls. Allow it in Settings.')
      }

      subscriptions.push(
        native.addListener('onFrame', frame => {
          onFrame(frame.pcm)
          onLevel(frame.level, frame.out ?? 0)
        }),
        native.addListener('onError', error => onError(error.message)),
      )
      await native.start()
    },
    play: pcm => native?.play(pcm),
    flush: () => native?.flush(),
    setSpeaker: on => native?.setSpeaker(on),
    stop() {
      for (const subscription of subscriptions.splice(0)) {
        subscription.remove()
      }

      void native?.stop().catch(() => undefined)
    },
  }
}
