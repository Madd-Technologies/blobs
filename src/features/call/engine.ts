/**
 * One voice call with a bot: the phone talks to xAI's realtime voice directly, with a one-time secret from the server's
 * hermes-voice plugin, and the voice hands real work to the bot's own chat. Pure: the socket, the audio, the secret and the
 * chat come in as ports, so the whole call can run against fakes.
 *
 * The flow follows hermes-xai's Desktop client (MIT, credited in the plugins repo): `hermes_task` becomes a normal turn in the
 * chat (`prompt.submit` with surface `voice-live`), the turn's final text goes back to the voice as a `[Hermes result]`
 * message, and results wait until the voice has finished its own response so they never cut it off.
 *
 * Two ways to talk. `live` is full duplex: xAI's voice detection hears you whenever you speak, and the line stays open (and
 * billed) for the whole call. `walkie` is push to talk: detection is off, the voice hears only what you hold the button for
 * (a commit starts its reply), and the line is put down whenever nobody is talking and the voice has finished, so the wait
 * while the bot works costs nothing. It is picked up again, with a new secret and the conversation so far, when you press to
 * talk or a result comes back.
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

/** `live`: always listening (xAI's voice detection). `walkie`: push to talk, the line open only while it is in use. */
export type CallMode = 'live' | 'walkie'

export interface CallPorts {
  /** A one-time secret and the first session for one connection. A walkie-talkie call asks again each time it picks up. */
  mint: () => Promise<Minted>
  connect: (url: string, protocols: string[]) => SocketLike
  audio: CallAudio
  /** Starts a turn in the bot's chat with this request; resolves once it is sent (false if it could not be). */
  delegate: (request: string, voiceContext: string) => Promise<boolean>
  onChange: (call: CallSnapshot) => void
  /** How you talk; `live` when not given. */
  mode?: CallMode
  now?: () => number
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
  mode: CallMode
  /** Walkie-talkie: you are holding (or have locked) the talk button. */
  talking: boolean
  /**
   * The line to xAI: `open`, being picked up (`opening`), or put down while nothing is said (`parked`, walkie-talkie only).
   * Nothing is billed while it is parked.
   */
  line: 'open' | 'opening' | 'parked'
}

export interface Call {
  start: () => Promise<void>
  hangUp: (note?: string) => void
  setMuted: (muted: boolean) => void
  /** Walkie-talkie: start talking (true: the voice stops) or stop and send what you said (false). */
  talk: (on: boolean) => void
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
/** A walkie-talkie call is billed only while its line is open, so a quiet one may wait much longer before it hangs up. */
export const WALKIE_QUIET_HANG_UP_MS = 15 * 60_000
/** How long a walkie-talkie line stays open once nothing is going on, so a quick reply does not wait for it to be picked up. */
export const PARK_MS = 8000
/** A press shorter than this was a slip: nothing is sent. */
export const MIN_TALK_MS = 250
/** On xAI a commit starts the reply; if none has started by then, it is asked for. */
export const REPLY_NUDGE_MS = 1500
/** The most microphone audio kept while the line is being picked up (frames are about 100 ms). */
export const PENDING_FRAMES = 600

/** What the voice is told about push to talk, and after a pause, the conversation so far. */
export function walkieInstructions(base: unknown, context: string): string {
  const persona = typeof base === 'string' ? base : ''
  const lines = [
    persona,
    'This call is push to talk: you hear the person only while they hold a button, so never ask whether they are still there, and keep replies short.',
  ]

  if (context) {
    lines.push(`The line was put down while nothing was being said and has just been picked up again; this is the call so far, so carry on from it without greeting again:\n${context}`)
  }

  return lines.filter(Boolean).join('\n\n')
}

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
  const mode: CallMode = ports.mode ?? 'live'
  const walkie = mode === 'walkie'
  const now = ports.now ?? Date.now
  let state: CallSnapshot = { phase: 'connecting', speaking: null, caption: null, tasks: 0, muted: false, note: null, mode, talking: false, line: 'opening' }
  let socket: SocketLike | null = null
  /** The socket is open (sends go out). */
  let open = false
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
  let parkTimer: unknown = null
  let nudgeTimer: unknown = null
  /** Walkie-talkie: when the talk button went down. */
  let pressedAt = 0
  /** Walkie-talkie: microphone audio said while the line was being picked up. */
  let pending: string[] = []
  /** Walkie-talkie: you let go while the line was being picked up; what you said is sent once it is open. */
  let commitWhenOpen = false

  function update(change: Partial<CallSnapshot>) {
    state = { ...state, ...change }
    ports.onChange(state)
  }

  function send(message: Record<string, unknown>) {
    if (socket && open && state.phase === 'live') {
      socket.send(JSON.stringify(message))
    }
  }

  function clear(timer: unknown) {
    if (timer !== null) {
      timers.clearTimeout(timer)
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

    quietTimer = timers.setTimeout(
      () => {
        // Never while a task is out or you are talking: the result is worth waiting for.
        if (state.tasks > 0 || responding || state.talking) {
          stillAwake()
        } else {
          hangUp(walkie ? 'Hung up after fifteen quiet minutes.' : 'Hung up after five quiet minutes.')
        }
      },
      walkie ? WALKIE_QUIET_HANG_UP_MS : QUIET_HANG_UP_MS,
    )
  }

  /** Walkie-talkie: put the line down soon, unless something is going on by then. */
  function parkSoon() {
    if (!walkie) {
      return
    }

    clear(parkTimer)
    parkTimer = timers.setTimeout(() => {
      parkTimer = null

      if (open && !state.talking && !responding && !results.length && !commitWhenOpen && !hangUpAfterResponse && state.phase === 'live') {
        park()
      }
    }, PARK_MS)
  }

  /** Walkie-talkie: closes the line to xAI (billing stops); the call itself goes on. */
  function park() {
    const was = socket
    socket = null
    open = false
    clear(nudgeTimer)
    nudgeTimer = null

    if (was) {
      was.onclose = null
      was.onmessage = null
      was.onerror = null

      try {
        was.close()
      } catch {
        // Already closed.
      }
    }

    responding = false
    update({ line: 'parked', speaking: state.speaking === 'voice' ? null : state.speaking })
  }

  /** Walkie-talkie: picks the line up again if it is down (to talk, or to say a result). */
  function pickUp() {
    if (state.phase === 'live' && !socket) {
      void connect()
    }
  }

  /** Sends what you said: on xAI the commit itself starts the reply, and if it does not, one is asked for. */
  function commitTurn() {
    commitWhenOpen = false
    send({ type: 'input_audio_buffer.commit' })
    responding = true
    stillAwake()
    clear(nudgeTimer)
    nudgeTimer = timers.setTimeout(() => {
      nudgeTimer = null

      if (open && responding) {
        send({ type: 'response.create' })
      }
    }, REPLY_NUDGE_MS)
  }

  function flushResults() {
    // While you talk, results wait: they are said after the voice has answered you.
    if (!results.length || responding || state.talking || state.phase !== 'live') {
      return
    }

    if (!open) {
      // Walkie-talkie: the line is down; it is picked up and they are said once it is open.
      pickUp()

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
        clear(nudgeTimer)
        nudgeTimer = null
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
        if (owedTurn && !spoke && !results.length && !state.talking) {
          send({ type: 'response.create' })
          responding = true
        }

        owedTurn = false
        flushResults()
        parkSoon()
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

    const was = socket
    socket = null

    for (const timer of [quietTimer, goodbyeTimer, parkTimer, nudgeTimer]) {
      clear(timer)
    }

    quietTimer = goodbyeTimer = parkTimer = nudgeTimer = null
    open = false
    pending = []
    commitWhenOpen = false

    if (was) {
      was.onclose = null
      was.onmessage = null

      try {
        was.close()
      } catch {
        // Already closed (or still being minted).
      }
    }

    if (audioOn) {
      audioOn = false
      ports.audio.stop()
    }

    results = []
    update({ phase: 'ended', speaking: null, tasks: 0, talking: false, note: note ?? null })
  }

  /** Opens a line to xAI: the first one starts the call; a walkie-talkie call opens another after each pause. */
  async function connect() {
    const first = state.phase === 'connecting'

    if (!first) {
      update({ line: 'opening' })
    }

    let minted: Minted
    // A stand-in, so a second pick-up does not start while this one is being minted.
    const placeholder = {} as SocketLike
    socket = placeholder

    try {
      minted = await ports.mint()
    } catch (error) {
      if (socket === placeholder) {
        socket = null
      }

      hangUp(error instanceof Error ? error.message : 'The call could not start.')

      return
    }

    if (state.phase === 'ended' || socket !== placeholder) {
      return
    }

    const line = ports.connect(minted.url, [`${minted.protocol_prefix}${minted.client_secret}`])
    socket = line
    line.onmessage = ({ data }) => {
      const event = parse(data)

      if (event && socket === line) {
        receive(event)
      }
    }
    line.onerror = () => {
      if (socket === line && !open) {
        hangUp(first ? 'Could not reach xAI’s voice service.' : 'Could not reach xAI’s voice service again.')
      }
    }
    line.onclose = ({ code, reason } = {}) => {
      if (socket !== line) {
        return
      }

      if (!open) {
        hangUp(first ? `xAI closed the call before it started${code ? ` (${code})` : ''}.` : `xAI would not pick the call up again${code ? ` (${code})` : ''}.`)
      } else if (walkie) {
        // xAI put the line down (a long pause, an expired secret): the call goes on, and it is picked up when needed.
        park()

        if (state.talking || commitWhenOpen || results.length) {
          pickUp()
        }
      } else {
        hangUp(reason || 'The call dropped.')
      }
    }
    line.onopen = () => {
      if (socket !== line) {
        return
      }

      open = true
      const session = walkie ? { ...minted.session, turn_detection: null, instructions: walkieInstructions(minted.session.instructions, first ? '' : voiceContext(turns)) } : minted.session

      update(first ? { phase: 'live', line: 'open' } : { line: 'open' })
      send({ type: 'session.update', session })
      stillAwake()

      if (first) {
        audioOn = true
        ports.audio
          .start(onFrame)
          .catch((error: unknown) => {
            audioOn = false
            hangUp(error instanceof Error ? `The microphone could not start: ${error.message}` : 'The microphone could not start.')
          })
      }

      // What you said while it was being picked up, then what waited to be said.
      for (const pcm of pending) {
        send({ type: 'input_audio_buffer.append', audio: pcm })
      }

      pending = []

      if (commitWhenOpen) {
        commitTurn()
      }

      flushResults()

      if (!state.talking && !responding) {
        parkSoon()
      }
    }
  }

  function onFrame(pcm: string) {
    if (!walkie) {
      if (!state.muted) {
        send({ type: 'input_audio_buffer.append', audio: pcm })
      }

      return
    }

    if (!state.talking) {
      return
    }

    if (open) {
      send({ type: 'input_audio_buffer.append', audio: pcm })
    } else if (pending.length < PENDING_FRAMES) {
      pending.push(pcm)
    }
  }

  function talk(on: boolean) {
    if (!walkie || state.phase !== 'live' || on === state.talking) {
      return
    }

    if (on) {
      clear(parkTimer)
      parkTimer = null
      pressedAt = now()
      pending = []
      commitWhenOpen = false
      // You talk over the voice: it stops at once.
      ports.audio.flush()

      if (responding) {
        send({ type: 'response.cancel' })
      }

      send({ type: 'input_audio_buffer.clear' })
      stillAwake()
      update({ talking: true, speaking: 'you' })
      pickUp()

      return
    }

    update({ talking: false, speaking: state.speaking === 'you' ? null : state.speaking })

    if (now() - pressedAt < MIN_TALK_MS) {
      pending = []
      send({ type: 'input_audio_buffer.clear' })
      parkSoon()

      return
    }

    if (open) {
      commitTurn()
    } else {
      commitWhenOpen = true
      pickUp()
    }
  }

  async function start() {
    if (started) {
      return
    }

    started = true
    ports.onChange(state)
    await connect()
  }

  return {
    start,
    hangUp,
    setMuted: muted => update({ muted }),
    talk,
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
