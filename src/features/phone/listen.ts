/**
 * Listening in on a phone errand's call, and taking it over: the phone holds one socket to the call service (hermes-phone
 * 0.2+), opened with a single-use ticket from the signed-in dashboard. Pure: the ticket, the socket and the call audio come in
 * as ports, so the whole flow runs against fakes.
 *
 * - Down: 100 ms of both sides as 8 kHz μ-law, played through the call-audio module at 24 kHz; where the call is (who has the
 *   line) and the transcript as it grows.
 * - Up: only while you have the line (`owner`) and are not muted, your microphone as 8 kHz μ-law. `take_over`, `hand_back`
 *   (with a note for the voice) and `leave` are the only other things sent.
 *
 * Neither the ticket nor the socket's address is ever logged or shown.
 */

import type { CallAudio, SocketLike } from '../call/engine.ts'
import type { CallMode, TranscriptLine } from '../../lib/hermes/phone.ts'
import { createDownlink, createUplink } from './audio.ts'

export interface ListenPorts {
  ticket: () => Promise<{ url: string; protocols: string[] }>
  connect: (url: string, protocols: string[]) => SocketLike
  audio: CallAudio
  onChange: (snapshot: ListenSnapshot) => void
}

export interface ListenSnapshot {
  phase: 'connecting' | 'listening' | 'ended'
  /** Who has this side of the call. */
  mode: CallMode
  /** You asked to take over and the voice is putting you on. */
  joining: boolean
  muted: boolean
  /** The call's transcript as the service has it (both sides, the voice's notes, and while you had the line). */
  lines: TranscriptLine[]
  /** Server clock, seconds: when the call was answered, and when its time limit ends it. */
  started: number | null
  ends: number | null
  /** Why it ended, or the last problem. */
  note: string | null
}

export interface Listen {
  start: () => Promise<void>
  takeOver: () => void
  handBack: (note?: string) => void
  setMuted: (muted: boolean) => void
  leave: () => void
  snapshot: () => ListenSnapshot
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const MODES: readonly CallMode[] = ['voice', 'hold', 'checking', 'handover', 'owner']

/** `join`: take the call over as soon as the socket is open ("Join the call"). */
export function createListen(ports: ListenPorts, options: { join?: boolean } = {}): Listen {
  let snap: ListenSnapshot = { phase: 'connecting', mode: 'voice', joining: !!options.join, muted: false, lines: [], started: null, ends: null, note: null }
  let socket: SocketLike | null = null
  let audioOn = false
  const down = createDownlink()
  const up = createUplink()

  const change = (next: Partial<ListenSnapshot>) => {
    snap = { ...snap, ...next }
    ports.onChange(snap)
  }

  const send = (message: Record<string, unknown>) => {
    try {
      socket?.send(JSON.stringify(message))
    } catch {
      // The close handler says what happened.
    }
  }

  function end(note: string | null) {
    if (snap.phase === 'ended') {
      return
    }

    const open = socket
    socket = null

    if (open) {
      open.onmessage = open.onclose = open.onerror = null
      open.close()
    }

    if (audioOn) {
      audioOn = false
      ports.audio.stop()
    }

    change({ phase: 'ended', joining: false, note })
  }

  function onMessage(raw: unknown) {
    let message: Record<string, unknown>

    try {
      message = JSON.parse(String(raw)) as Record<string, unknown>
    } catch {
      return
    }

    switch (message.type) {
      case 'hello': {
        const mode = MODES.includes(message.mode as CallMode) ? (message.mode as CallMode) : 'voice'
        change({ phase: 'listening', mode, started: Number(message.started) || null, ends: Number(message.ends) || null })

        if (snap.joining && mode !== 'owner') {
          send({ type: 'take_over' })
        }

        return
      }

      case 'audio': {
        const pcmu = str(message.pcmu)

        if (pcmu && audioOn) {
          ports.audio.play(down(pcmu))
        }

        return
      }

      case 'state': {
        const mode = MODES.includes(message.mode as CallMode) ? (message.mode as CallMode) : snap.mode
        change({ mode, joining: mode === 'owner' ? false : snap.joining || mode === 'handover' })

        return
      }

      case 'lines': {
        const from = Math.max(0, Math.min(snap.lines.length, Number(message.from) || 0))
        const lines = Array.isArray(message.lines) ? (message.lines as TranscriptLine[]).filter(line => typeof line?.text === 'string') : []
        change({ lines: [...snap.lines.slice(0, from), ...lines] })

        return
      }

      case 'refused':
        change({ joining: false, note: str(message.message) || 'The call can’t be joined right now.' })

        return

      case 'end':
        end('The call ended.')

        return
    }
  }

  return {
    async start() {
      try {
        await ports.audio.start(pcm => {
          if (snap.mode === 'owner' && !snap.muted && snap.phase === 'listening') {
            send({ type: 'audio', pcmu: up(pcm) })
          }
        })
        audioOn = true
        const ticket = await ports.ticket()

        if (snap.phase === 'ended') {
          return
        }

        const open = ports.connect(ticket.url, ticket.protocols)
        socket = open
        open.onmessage = event => onMessage(event.data)
        open.onerror = () => undefined
        open.onclose = () => end(snap.mode === 'owner' ? 'The connection dropped. The voice takes the call back in a few seconds.' : 'The connection dropped.')
      } catch (error) {
        end(error instanceof Error && error.message ? error.message : 'Couldn’t listen in.')
      }
    },

    takeOver() {
      if (snap.phase !== 'listening' || snap.mode === 'owner' || snap.joining) {
        return
      }

      change({ joining: true, note: null })
      send({ type: 'take_over' })
    },

    handBack(note) {
      if (snap.mode !== 'owner' && snap.mode !== 'handover') {
        return
      }

      send({ type: 'hand_back', note: (note ?? '').trim().slice(0, 300) })
      ports.audio.flush()
    },

    setMuted(muted) {
      change({ muted })
    },

    leave() {
      if (snap.mode === 'owner' || snap.mode === 'handover') {
        send({ type: 'hand_back', note: '' })
      }

      send({ type: 'leave' })
      end(null)
    },

    snapshot: () => snap,
  }
}
