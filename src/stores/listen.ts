import { create } from 'zustand'

import type { SocketLike } from '@/features/call/engine'
import { createListen, type Listen, type ListenSnapshot } from '@/features/phone/listen'
import { callAudio, canCall } from '@/lib/duplexAudio'
import { listenTicket } from '@/lib/hermes/phone'
import { useCall } from '@/stores/call'
import { useConnection } from '@/stores/connection'

interface ListenState {
  /** The phone errand's call you are listening in on (or whose ending is still shown). */
  errandId: string | null
  callId: string | null
  snap: ListenSnapshot | null
  /** How loud the line is as it plays, 0 to 1, and you while you have it. */
  level: number
  voiceLevel: number
  speaker: boolean
  /** Starts listening (`join`: and takes the call over at once). Returns a problem to show, or null. */
  start: (errandId: string, callId: string, options?: { join?: boolean }) => string | null
  takeOver: () => void
  handBack: (note?: string) => void
  setMuted: (muted: boolean) => void
  setSpeaker: (on: boolean) => void
  /** Stops listening (handing the call back first if you have it). */
  leave: () => void
}

let engine: Listen | null = null
let audio: ReturnType<typeof callAudio> | null = null

/** Whether this phone can listen in on a call at all: the Android call-audio module (not on iPhone or in Expo Go). */
export const canListen = (): boolean => canCall()

/**
 * The one phone errand call the app can listen in on. It uses the same call audio as a voice call with a bot, so the two
 * never run at once.
 */
export const useListen = create<ListenState>((set, get) => ({
  errandId: null,
  callId: null,
  snap: null,
  level: 0,
  voiceLevel: 0,
  speaker: true,

  start: (errandId, callId, options = {}) => {
    const config = useConnection.getState().config

    if (!config) {
      return 'Not connected to the server.'
    }

    if (!canCall()) {
      return 'Listening in needs the Android app.'
    }

    if (useCall.getState().call && useCall.getState().call?.phase !== 'ended') {
      return 'End the voice call first.'
    }

    const { errandId: current, callId: currentCall, snap } = get()

    if (engine && current === errandId && currentCall === callId && snap?.phase !== 'ended') {
      if (options.join) {
        engine.takeOver()
      }

      return null
    }

    engine?.leave()
    audio = callAudio(
      (you, line) => set({ level: you, voiceLevel: line }),
      message => set(state => ({ snap: state.snap ? { ...state.snap, note: message } : state.snap })),
    )
    const port = audio
    const listen = createListen(
      {
        ticket: () => listenTicket(config, errandId, callId),
        connect: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
        audio: port,
        onChange: next => {
          if (engine === listen) {
            set({ snap: next })
          }

          if (next.phase === 'ended' && engine === listen) {
            engine = null
            audio = null
            set({ level: 0, voiceLevel: 0 })
          }
        },
      },
      { join: options.join },
    )
    engine = listen
    set({ errandId, callId, snap: listen.snapshot(), level: 0, voiceLevel: 0 })
    void listen.start().then(() => port.setSpeaker(get().speaker))

    return null
  },

  takeOver: () => engine?.takeOver(),
  handBack: note => engine?.handBack(note),
  setMuted: muted => engine?.setMuted(muted),

  setSpeaker: on => {
    audio?.setSpeaker(on)
    set({ speaker: on })
  },

  leave: () => {
    engine?.leave()
    engine = null
    audio = null
    set({ errandId: null, callId: null, snap: null, level: 0, voiceLevel: 0 })
  },
}))
