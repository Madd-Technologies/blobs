/**
 * One voice call with a bot: the phone talks to xAI's realtime voice directly, with a one-time secret from the server's
 * hermes-voice plugin, and the voice hands real work to the bot's own chat. Pure: the socket, the audio, the secret and the
 * chat come in as ports, so the whole call can run against fakes.
 *
 * The flow follows hermes-xai's Desktop client (MIT, credited in the plugins repo): `hermes_task` becomes a normal turn in the
 * chat (`prompt.submit` with surface `voice-live`), the turn's final text goes back to the voice as a `[Hermes result]`
 * message, and results wait until the voice has finished its own response so they never cut it off.
 */

import type { Minted } from '../../lib/hermes/voice.ts'

export type { Minted }

/** The part of a WebSocket the call uses (React Native's and the browser's both fit). */
export interface SocketLike {
  send: (data: string) => void
  close: () => void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code?: number; reason?: string }) => void) | null
  onerror: ((event: unknown) => void) | null
}

/** The phone's microphone and speaker, full duplex with echo cancellation. Frames and chunks are base64 PCM16 at 24 kHz. */
export interface CallAudio {
  start: (onFrame: (pcm: string) => void) => Promise<void>
  play: (pcm: string) => void
  /** Drops what is still queued to play: you started talking over the voice. */
  flush: () => void
  stop: () => void
}

export interface CallPorts {
  mint: () => Promise<Minted>
  connect: (url: string, protocols: string[]) => SocketLike
  audio: CallAudio
  /** Starts a turn in the bot's chat with this request; resolves once it is sent (false if it could not be). */
  delegate: (request: string, voiceContext: string) => Promise<boolean>
  onChange: (call: CallSnapshot) => void
  timers?: { setTimeout: (run: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void }
}

export type CallPhase = 'connecting' | 'live' | 'ended'

export interface CallSnapshot {
  phase: CallPhase
  /** Who is talking, for the face: you (the server heard speech) or the voice (its audio is arriving). */
  speaking: 'you' | 'voice' | null
  /** The newest caption line. */
  caption: { who: 'you' | 'voice'; text: string } | null
  /** Tasks handed to the bot that have not come back yet. */
  tasks: number
  muted: boolean
  /** Why the call ended, or the last problem while it runs. */
  note: string | null
}

export interface Call {
  start: () => Promise<void>
  hangUp: (note?: string) => void
  setMuted: (muted: boolean) => void
  /** A delegated turn finished (its `message.complete`). Ignored when no task is out. */
  result: (text: string, status?: string) => void
  /** Something in the chat waits for a tap (an approval or a question). */
  needsYou: (line: string) => void
  snapshot: () => CallSnapshot
}

/** Spoken turns kept for the bot's context. */
export const CONTEXT_TURNS = 12
/** Hermes keeps only the first 6000 characters of `voice_context`, so the newest lines must fit in that. */
export const CONTEXT_CHARS = 6000
/** The longest result the voice is given to say. */
export const RESULT_CHARS = 3000
/** With server VAD a call is billed while it is open, so a quiet call hangs up. */
export const QUIET_HANG_UP_MS = 5 * 60_000
/** Room for the goodbye to play before `end_call` hangs up. */
export const GOODBYE_MS = 2500

/** The recent spoken turns, newest last, cut from the front to what Hermes keeps. */
export function voiceContext(turns: readonly string[]): string {
  const lines = turns.slice(-CONTEXT_TURNS)

  while (lines.length > 1 && lines.join('\n').length > CONTEXT_CHARS) {
    lines.shift()
  }

  const text = lines.join('\n')

  return text.length > CONTEXT_CHARS ? text.slice(-CONTEXT_CHARS) : text
}

/** What the voice is told when a task comes back. */
export function resultLine(text: string, status?: string): string {
  const said = text.trim().slice(0, RESULT_CHARS)

  if (status === 'error') {
    return `The task failed. ${said}`.trim()
  }

  return said || 'It finished, with nothing to report.'
}

function parse(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    const value = JSON.parse(data) as unknown

    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export function createCall(ports: CallPorts): Call {
  const timers = ports.timers ?? { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  let state: CallSnapshot = { phase: 'connecting', speaking: null, caption: null, tasks: 0, muted: false, note: null }
  let socket: SocketLike | null = null
  let started = false
  let audioOn = false
  /** A response is in progress: results wait for it to finish. */
  let responding = false
  /** The current response has produced audio. */
  let spoke = false
  /** The voice called `hermes_task` and still owes the user a word ("on it"). */
  let owedTurn = false
  let hangUpAfterResponse = false
  let results: string[] = []
  const turns: string[] = []
  /** The transcript item your last words came from (empty when xAI sends none), or null after the voice spoke. */
  let lastYou: string | null = null
  let voiceLine = ''
  let quietTimer: unknown = null
  let goodbyeTimer: unknown = null

  function update(change: Partial<CallSnapshot>) {
    state = { ...state, ...change }
    ports.onChange(state)
  }

  function send(message: Record<string, unknown>) {
    if (socket && state.phase === 'live') {
      socket.send(JSON.stringify(message))
    }
  }

  function remember(who: 'You' | 'Voice', text: string, item = '') {
    const said = text.trim()

    if (!said) {
      return
    }

    // xAI sends a transcript again as it refines it: a newer version of the same words replaces the older one.
    const again = who === 'You' && lastYou !== null && (item ? item === lastYou : true) && turns.at(-1)?.startsWith('You: ')

    if (again) {
      turns[turns.length - 1] = `You: ${said}`
    } else {
      turns.push(`${who}: ${said}`)
      turns.splice(0, Math.max(0, turns.length - CONTEXT_TURNS))
    }

    lastYou = who === 'You' ? item : null
  }

  function stillAwake() {
    if (quietTimer !== null) {
      timers.clearTimeout(quietTimer)
    }

    quietTimer = timers.setTimeout(() => {
      // Never while a task is out: the result is worth waiting for.
      if (state.tasks > 0 || responding) {
        stillAwake()
      } else {
        hangUp('Hung up after five quiet minutes.')
      }
    }, QUIET_HANG_UP_MS)
  }

  function flushResults() {
    if (!results.length || responding || state.phase !== 'live') {
      return
    }

    const text = results.join('\n\n')
    results = []
    send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
    send({ type: 'response.create' })
    responding = true
  }

  async function delegate(request: string) {
    update({ tasks: state.tasks + 1 })
    const sent = await ports.delegate(request, voiceContext(turns)).catch(() => false)

    if (!sent && state.phase === 'live') {
      update({ tasks: Math.max(0, state.tasks - 1) })
      results.push('[Hermes result] The task could not be started.')
      flushResults()
    }
  }

  function onTool(name: string, callId: string, rawArgs: string) {
    let args: Record<string, unknown> = {}

    try {
      args = (JSON.parse(rawArgs || '{}') as Record<string, unknown>) ?? {}
    } catch {
      // Unreadable arguments: treated as none.
    }

    let output: Record<string, unknown> = { ok: true }

    if (name === 'hermes_task') {
      const request = str(args.request).trim()

      if (request) {
        void delegate(request)
        output = { receipt: 'started', note: 'The result will arrive in a "[Hermes result]" message.' }
        owedTurn = true
      } else {
        output = { ok: false, error: 'The request was empty.' }
      }
    } else if (name === 'end_call') {
      hangUpAfterResponse = true
    } else {
      output = { ok: false, error: 'unknown tool' }
    }

    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } })
  }

  function receive(event: Record<string, unknown>) {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        // You started talking: the voice stops at once.
        ports.audio.flush()
        stillAwake()
        update({ speaking: 'you' })
        break
      case 'input_audio_buffer.speech_stopped':
        update({ speaking: state.speaking === 'you' ? null : state.speaking })
        break
      case 'conversation.item.input_audio_transcription.updated':
      case 'conversation.item.input_audio_transcription.completed': {
        const said = str(event.transcript).trim()

        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          remember('You', said, str(event.item_id))
        }

        if (said) {
          update({ caption: { who: 'you', text: said } })
        }

        break
      }
      case 'response.created':
        responding = true
        spoke = false
        voiceLine = ''
        break
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const pcm = str(event.delta)

        if (pcm) {
          spoke = true
          ports.audio.play(pcm)

          if (state.speaking !== 'voice') {
            update({ speaking: 'voice' })
          }
        }

        break
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        voiceLine += str(event.delta)
        update({ caption: { who: 'voice', text: voiceLine } })
        break
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const said = str(event.transcript) || voiceLine

        remember('Voice', said)
        update({ caption: said.trim() ? { who: 'voice', text: said.trim() } : state.caption })
        break
      }
      case 'response.function_call_arguments.done':
        onTool(str(event.name), str(event.call_id), str(event.arguments) || '{}')
        break
      case 'response.done':
        responding = false
        stillAwake()

        if (state.speaking === 'voice') {
          update({ speaking: null })
        }

        if (hangUpAfterResponse) {
          goodbyeTimer = timers.setTimeout(() => hangUp(), GOODBYE_MS)
          break
        }

        // The response that called the tool said nothing aloud: ask for a word, unless a result is already here to say.
        if (owedTurn && !spoke && !results.length) {
          send({ type: 'response.create' })
          responding = true
        }

        owedTurn = false
        flushResults()
        break
      case 'error': {
        const error = event.error as { message?: unknown } | undefined

        update({ note: str(error?.message) || 'The voice reported an error.' })
        break
      }
      default:
        break
    }
  }

  function hangUp(note?: string) {
    if (state.phase === 'ended') {
      return
    }

    const open = socket
    socket = null

    for (const timer of [quietTimer, goodbyeTimer]) {
      if (timer !== null) {
        timers.clearTimeout(timer)
      }
    }

    quietTimer = goodbyeTimer = null

    if (open) {
      open.onclose = null
      open.onmessage = null

      try {
        open.close()
      } catch {
        // Already closed.
      }
    }

    if (audioOn) {
      audioOn = false
      ports.audio.stop()
    }

    results = []
    update({ phase: 'ended', speaking: null, tasks: 0, note: note ?? null })
  }

  async function start() {
    if (started) {
      return
    }

    started = true
    ports.onChange(state)
    let minted: Minted

    try {
      minted = await ports.mint()
    } catch (error) {
      hangUp(error instanceof Error ? error.message : 'The call could not start.')

      return
    }

    if (state.phase === 'ended') {
      return
    }

    const open = ports.connect(minted.url, [`${minted.protocol_prefix}${minted.client_secret}`])
    socket = open
    open.onmessage = ({ data }) => {
      const event = parse(data)

      if (event && socket === open) {
        receive(event)
      }
    }
    open.onerror = () => {
      if (socket === open && state.phase === 'connecting') {
        hangUp('Could not reach xAI’s voice service.')
      }
    }
    open.onclose = ({ code, reason } = {}) => {
      if (socket === open) {
        hangUp(state.phase === 'connecting' ? `xAI closed the call before it started${code ? ` (${code})` : ''}.` : reason || 'The call dropped.')
      }
    }
    open.onopen = () => {
      if (socket !== open) {
        return
      }

      update({ phase: 'live' })
      send({ type: 'session.update', session: minted.session })
      stillAwake()
      audioOn = true
      ports.audio
        .start(pcm => {
          if (!state.muted) {
            send({ type: 'input_audio_buffer.append', audio: pcm })
          }
        })
        .catch((error: unknown) => {
          audioOn = false
          hangUp(error instanceof Error ? `The microphone could not start: ${error.message}` : 'The microphone could not start.')
        })
    }
  }

  return {
    start,
    hangUp,
    setMuted: muted => update({ muted }),
    result: (text, status) => {
      if (state.phase !== 'live' || state.tasks === 0) {
        return
      }

      update({ tasks: state.tasks - 1 })
      // Saying the result is the word the voice owed.
      owedTurn = false
      results.push(`[Hermes result] ${resultLine(text, status)}`)
      flushResults()
    },
    needsYou: line => {
      if (state.phase !== 'live') {
        return
      }

      results.push(`[Hermes needs you] ${line.trim().slice(0, 300) || 'Something needs your answer.'}`)
      flushResults()
    },
    snapshot: () => state,
  }
}
