import { create } from 'zustand'

import { createCall, type Call, type CallSnapshot, type SocketLike } from '@/features/call/engine'
import { asHermesEvent } from '@/lib/hermes/protocol'
import { startVoiceSession } from '@/lib/hermes/voice'
import { pendingPrompts } from '@/features/transcript/reduce'
import { callAudio } from '@/lib/duplexAudio'
import { onGatewayEvent, useConnection } from '@/stores/connection'
import { sessions } from '@/stores/sessions'

interface CallState {
  /** The bot on the call, while there is one (or its ending is still shown). */
  profile: string | null
  call: CallSnapshot | null
  /** When the call went live (ms), for its clock. */
  since: number | null
  /** How loud you are, 0 to 1, for the call screen's rings. */
  level: number
  /** How loud the voice is as it plays, 0 to 1. */
  voiceLevel: number
  speaker: boolean
  start: (profile: string, caller: { name: string; about?: string }) => void
  hangUp: () => void
  setMuted: (muted: boolean) => void
  setSpeaker: (on: boolean) => void
}

/** How long a finished call's last word stays on screen before the chat's composer comes back; longer when it says why. */
const ENDED_MS = 2500
const ENDED_NOTE_MS = 5000

let engine: Call | null = null
let audio: ReturnType<typeof callAudio> | null = null
let cleanup: (() => void) | null = null

/**
 * The one voice call the app can hold. It belongs to the chat it was started from: tasks the voice hands over are turns in that
 * chat (your bubble, the bot's reply, and its approval cards, answered by tap), and their results go back to the voice.
 */
export const useCall = create<CallState>((set, get) => ({
  profile: null,
  call: null,
  since: null,
  level: 0,
  voiceLevel: 0,
  speaker: true,

  start(profile, caller) {
    const config = useConnection.getState().config

    if (!config || (get().call && get().call?.phase !== 'ended')) {
      return
    }

    cleanup?.()
    audio = callAudio(
      (level, voiceLevel) => {
        // Ten frames a second: only a change worth drawing is set.
        const now = get()

        if (Math.abs(now.level - level) > 0.02 || Math.abs(now.voiceLevel - voiceLevel) > 0.02) {
          set({ level, voiceLevel })
        }
      },
      message => engine?.hangUp(message),
    )
    set({ profile, call: null, since: null, level: 0, voiceLevel: 0, speaker: true })

    const call = createCall({
      mint: () => startVoiceSession(config, profile, caller),
      connect: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      audio,
      delegate: (request, voiceContext) => sessions.send(profile, request, [], { voiceContext }),
      onChange: snapshot => {
        const went = snapshot.phase === 'live' && !get().since

        set(state => ({ call: snapshot, since: went ? Date.now() : state.since }))

        // The chat marks where the call began, so what it handed over reads in place (only between turns, and never stored).
        if (went) {
          sessions.showNote(profile, `Call started ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
        }

        if (snapshot.phase === 'ended') {
          finish(snapshot)
        }
      },
    })

    engine = call

    // A delegated turn's last word goes back to the voice.
    const stopEvents = onGatewayEvent(raw => {
      const event = asHermesEvent(raw)
      const liveId = sessions.store.getState().bots[profile]?.liveId

      if (event?.type === 'message.complete' && liveId && event.session_id === liveId) {
        call.result(event.payload.text ?? '', event.payload.status)
      }
    })

    // A new approval or question in the chat: the voice says so, and the card waits for a tap.
    const before = sessions.store.getState().bots[profile]?.transcript
    const told = new Set(before ? pendingPrompts(before).map(prompt => prompt.requestId) : [])
    const stopPrompts = sessions.store.subscribe(state => {
      const transcript = state.bots[profile]?.transcript

      for (const prompt of transcript ? pendingPrompts(transcript) : []) {
        if (!told.has(prompt.requestId)) {
          told.add(prompt.requestId)
          call.needsYou(prompt.kind === 'approval' ? `Approve: ${prompt.description}` : prompt.kind === 'question' ? (prompt.questions[0]?.question ?? 'A question') : 'A secret or password is needed')
        }
      }
    })

    cleanup = () => {
      stopEvents()
      stopPrompts()
      cleanup = null
    }

    void call.start()

    function finish(snapshot: CallSnapshot) {
      cleanup?.()

      if (engine === call) {
        engine = null
        audio = null
      }

      setTimeout(
        () => {
          if (get().call === snapshot) {
            set({ profile: null, call: null, since: null, level: 0, voiceLevel: 0 })
          }
        },
        snapshot.note ? ENDED_NOTE_MS : ENDED_MS,
      )
    }
  },

  hangUp() {
    engine?.hangUp()
  },

  setMuted(muted) {
    engine?.setMuted(muted)
  },

  setSpeaker(on) {
    audio?.setSpeaker(on)
    set({ speaker: on })
  },
}))
