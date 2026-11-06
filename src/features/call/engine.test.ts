import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CONTEXT_CHARS, createCall, GOODBYE_MS, MIN_TALK_MS, PARK_MS, QUIET_HANG_UP_MS, REPLY_NUDGE_MS, resultLine, voiceContext, type CallMode, type CallPorts, type CallSnapshot, type Minted, type SocketLike } from './engine.ts'

const minted: Minted = {
  url: 'wss://api.x.ai/v1/realtime?model=grok-voice-latest',
  protocol_prefix: 'xai-client-secret.',
  client_secret: 'secret-1',
  expires_at: 1_800_000_000,
  model: 'grok-voice-latest',
  account: 'sign-in',
  session: { voice: 'eve', instructions: 'Be Orion.' },
}

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  readonly url: string
  readonly protocols: string[]

  constructor(url: string, protocols: string[]) {
    this.url = url
    this.protocols = protocols
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close() {
    this.closed = true
  }

  /** The server sends an event. */
  emit(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }

  types() {
    return this.sent.map(message => message.type)
  }
}

function harness(options: { delegate?: (request: string, context: string) => Promise<boolean>; mint?: () => Promise<Minted>; audioFails?: boolean; mode?: CallMode } = {}) {
  const sockets: FakeSocket[] = []
  const played: string[] = []
  const log: string[] = []
  const delegated: { request: string; context: string }[] = []
  const snapshots: CallSnapshot[] = []
  const pending = new Map<number, { run: () => void; ms: number }>()
  let nextTimer = 1
  let frame: ((pcm: string) => void) | null = null
  let clock = 0
  let mints = 0

  const ports: CallPorts = {
    mint:
      options.mint ??
      (() => {
        mints += 1

        return Promise.resolve({ ...minted, client_secret: `secret-${mints}` })
      }),
    mode: options.mode,
    now: () => clock,
    connect: (url, protocols) => {
      const socket = new FakeSocket(url, protocols)
      sockets.push(socket)

      return socket
    },
    audio: {
      start: onFrame => {
        log.push('start')
        frame = onFrame

        return options.audioFails ? Promise.reject(new Error('permission denied')) : Promise.resolve()
      },
      play: pcm => played.push(pcm),
      flush: () => log.push('flush'),
      stop: () => log.push('stop'),
    },
    delegate:
      options.delegate ??
      ((request, context) => {
        delegated.push({ request, context })

        return Promise.resolve(true)
      }),
    onChange: snapshot => snapshots.push(snapshot),
    timers: {
      setTimeout: (run, ms) => {
        const id = nextTimer++
        pending.set(id, { run, ms })

        return id
      },
      clearTimeout: handle => pending.delete(handle as number),
    },
  }

  const call = createCall(ports)

  return {
    call,
    sockets,
    played,
    log,
    delegated,
    snapshots,
    socket: () => sockets[0] as FakeSocket,
    latest: () => sockets.at(-1) as FakeSocket,
    later: (ms: number) => {
      clock += ms
    },
    speak: (pcm: string) => frame?.(pcm),
    /** Runs every timer of exactly this length. */
    fire: (ms: number) => {
      for (const [id, timer] of [...pending]) {
        if (timer.ms === ms) {
          pending.delete(id)
          timer.run()
        }
      }
    },
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

async function live(h: ReturnType<typeof harness>) {
  await h.call.start()
  h.socket().onopen?.()
  await tick()
}

describe('a call', () => {
  it('opens xAI with the one-time secret as its subprotocol, then sends the session and streams the microphone', async () => {
    const h = harness()

    await live(h)

    assert.equal(h.socket().url, minted.url)
    assert.deepEqual(h.socket().protocols, ['xai-client-secret.secret-1'])
    assert.deepEqual(h.socket().sent[0], { type: 'session.update', session: minted.session })
    assert.equal(h.call.snapshot().phase, 'live')

    h.speak('AAAA')
    assert.deepEqual(h.socket().sent[1], { type: 'input_audio_buffer.append', audio: 'AAAA' })
  })

  it('sends nothing from the microphone while muted', async () => {
    const h = harness()

    await live(h)
    h.call.setMuted(true)
    h.speak('AAAA')

    assert.deepEqual(h.socket().types(), ['session.update'])
  })

  it('plays the voice, and stops it the moment you start talking', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.output_audio.delta', delta: 'UklG' })
    assert.deepEqual(h.played, ['UklG'])
    assert.equal(h.call.snapshot().speaking, 'voice')

    h.socket().emit({ type: 'input_audio_buffer.speech_started' })
    assert.ok(h.log.includes('flush'))
    assert.equal(h.call.snapshot().speaking, 'you')
  })

  it('captions what you said and what the voice is saying', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'What is on my calendar?' })
    assert.deepEqual(h.call.snapshot().caption, { who: 'you', text: 'What is on my calendar?' })

    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.output_audio_transcript.delta', delta: 'Let me ' })
    h.socket().emit({ type: 'response.output_audio_transcript.delta', delta: 'check.' })
    assert.deepEqual(h.call.snapshot().caption, { who: 'voice', text: 'Let me check.' })
  })
})

describe('handing work to the bot', () => {
  it('keeps one line per thing you said, though xAI refines the transcript several times', async () => {
    const h = harness()

    await live(h)
    for (const transcript of ['Hi, please ask Or', 'Hi, please ask Orion the time', 'Hi, please ask Orion the time in Tokyo.']) {
      h.socket().emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript })
    }
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"What time is it in Tokyo?"}' })
    await tick()

    assert.equal(h.delegated[0]?.context, 'You: Hi, please ask Orion the time in Tokyo.')
  })

  it('turns hermes_task into a chat turn with the recent spoken turns, and answers the tool at once', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Book the dentist for Thursday.' })
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: JSON.stringify({ request: 'Book the dentist for Thursday morning.' }) })
    await tick()

    assert.deepEqual(h.delegated, [{ request: 'Book the dentist for Thursday morning.', context: 'You: Book the dentist for Thursday.' }])
    assert.equal(h.call.snapshot().tasks, 1)
    const output = h.socket().sent.find(message => message.type === 'conversation.item.create') as { item: { type: string; call_id: string } }
    assert.equal(output.item.type, 'function_call_output')
    assert.equal(output.item.call_id, 'call-1')
  })

  it('asks the voice for a word when the tool call said nothing aloud', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Check the weather."}' })
    h.socket().emit({ type: 'response.done' })

    assert.equal(h.socket().types().at(-1), 'response.create')
  })

  it('does not ask again when the voice already said something', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.output_audio.delta', delta: 'T24gaXQ=' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Check the weather."}' })
    h.socket().emit({ type: 'response.done' })

    assert.notEqual(h.socket().types().at(-1), 'response.create')
  })

  it('holds a result until the voice finishes its response, then has it said', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.output_audio.delta', delta: 'T24gaXQ=' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Check the weather."}' })
    await tick()

    h.call.result('Sunny, 21 degrees.', 'complete')
    assert.equal(h.call.snapshot().tasks, 0)
    assert.ok(!JSON.stringify(h.socket().sent).includes('Sunny'), 'not while the voice is still responding')

    h.socket().emit({ type: 'response.done' })
    const said = h.socket().sent.at(-2) as { item: { content: { text: string }[] } }
    assert.equal(said.item.content[0]?.text, '[Hermes result] Sunny, 21 degrees.')
    assert.equal(h.socket().types().at(-1), 'response.create')
  })

  it('says when a task could not start', async () => {
    const h = harness({ delegate: () => Promise.resolve(false) })

    await live(h)
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Send it."}' })
    await tick()

    assert.equal(h.call.snapshot().tasks, 0)
    assert.ok(JSON.stringify(h.socket().sent).includes('[Hermes result] The task could not be started.'))
  })

  it('ignores a turn that finishes when no task is out', async () => {
    const h = harness()

    await live(h)
    h.call.result('A routine ran.', 'complete')

    assert.deepEqual(h.socket().types(), ['session.update'])
  })

  it('tells the voice when something waits for a tap', async () => {
    const h = harness()

    await live(h)
    h.call.needsYou('Run rm -rf build/?')

    assert.ok(JSON.stringify(h.socket().sent).includes('[Hermes needs you] Run rm -rf build/?'))
  })
})

describe('ending a call', () => {
  it('hangs up after the goodbye when the voice calls end_call', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'end_call', call_id: 'call-2', arguments: '{}' })
    h.socket().emit({ type: 'response.done' })
    assert.equal(h.call.snapshot().phase, 'live')

    h.fire(GOODBYE_MS)
    assert.equal(h.call.snapshot().phase, 'ended')
    assert.ok(h.socket().closed)
    assert.ok(h.log.includes('stop'))
  })

  it('hangs up after five quiet minutes, but never while a task is out', async () => {
    const h = harness()

    await live(h)
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Long job."}' })
    await tick()
    h.fire(QUIET_HANG_UP_MS)
    assert.equal(h.call.snapshot().phase, 'live')

    h.call.result('Done.', 'complete')
    // The voice says the result, then the line goes quiet.
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.done' })
    h.fire(QUIET_HANG_UP_MS)
    assert.equal(h.call.snapshot().phase, 'ended')
    assert.equal(h.call.snapshot().note, 'Hung up after five quiet minutes.')
  })

  it('ends with the server’s refusal when no secret can be made', async () => {
    const h = harness({ mint: () => Promise.reject(new Error('Calls are off for this bot.')) })

    await h.call.start()

    assert.equal(h.sockets.length, 0)
    assert.equal(h.call.snapshot().phase, 'ended')
    assert.equal(h.call.snapshot().note, 'Calls are off for this bot.')
  })

  it('ends when the microphone cannot start', async () => {
    const h = harness({ audioFails: true })

    await live(h)

    assert.equal(h.call.snapshot().phase, 'ended')
    assert.match(h.call.snapshot().note ?? '', /permission denied/)
  })

  it('says the call dropped when xAI closes it', async () => {
    const h = harness()

    await live(h)
    h.socket().onclose?.({ code: 1006 })

    assert.equal(h.call.snapshot().phase, 'ended')
    assert.equal(h.call.snapshot().note, 'The call dropped.')
    assert.ok(h.log.includes('stop'))
  })

  it('a hang-up before the socket opens leaves nothing running', async () => {
    const h = harness()

    await h.call.start()
    h.call.hangUp()
    h.socket().onopen?.()

    assert.equal(h.call.snapshot().phase, 'ended')
    assert.ok(!h.log.includes('start'))
  })
})

describe('voiceContext', () => {
  it('keeps the newest turns that fit what Hermes keeps', () => {
    const turns = Array.from({ length: 20 }, (_, i) => `You: ${String(i).padStart(2, '0')} ${'x'.repeat(900)}`)
    const context = voiceContext(turns)

    assert.ok(context.length <= CONTEXT_CHARS)
    assert.ok(context.endsWith(turns[19] as string))
    assert.ok(!context.includes('You: 13 '))
  })
})

describe('resultLine', () => {
  it('says failures as failures, and something for a silent finish', () => {
    assert.equal(resultLine('Error: no such file', 'error'), 'The task failed. Error: no such file')
    assert.equal(resultLine('  ', 'complete'), 'It finished, with nothing to report.')
    assert.equal(resultLine('x'.repeat(5000)).length, 3000)
  })
})

describe('a walkie-talkie call', () => {
  const walkie = () => harness({ mode: 'walkie' })

  it('turns xAI’s voice detection off, tells the voice it is push to talk, and sends nothing until you hold the button', async () => {
    const h = walkie()

    await live(h)
    const session = h.socket().sent[0]?.session as Record<string, unknown>

    assert.equal(session.turn_detection, null)
    assert.equal(session.voice, 'eve')
    assert.match(String(session.instructions), /^Be Orion\.\n\nThis call is push to talk/)
    assert.equal(h.call.snapshot().mode, 'walkie')

    h.speak('AAAA')
    assert.deepEqual(h.socket().types(), ['session.update'])
  })

  it('sends what you say while you hold, and commits it when you let go (the commit starts the reply)', async () => {
    const h = walkie()

    await live(h)
    h.call.talk(true)
    h.speak('AAAA')
    h.later(MIN_TALK_MS + 500)
    h.call.talk(false)

    assert.deepEqual(h.socket().types(), ['session.update', 'input_audio_buffer.clear', 'input_audio_buffer.append', 'input_audio_buffer.commit'])
    assert.equal(h.call.snapshot().talking, false)

    // xAI started the reply on its own: no second one is asked for.
    h.socket().emit({ type: 'response.created' })
    h.fire(REPLY_NUDGE_MS)
    assert.ok(!h.socket().types().includes('response.create'))
  })

  it('asks for the reply if the commit did not start one', async () => {
    const h = walkie()

    await live(h)
    h.call.talk(true)
    h.later(1000)
    h.call.talk(false)
    h.fire(REPLY_NUDGE_MS)

    assert.equal(h.socket().types().at(-1), 'response.create')
  })

  it('sends nothing for a slip of the finger', async () => {
    const h = walkie()

    await live(h)
    h.call.talk(true)
    h.speak('AAAA')
    h.later(MIN_TALK_MS - 1)
    h.call.talk(false)

    assert.ok(!h.socket().types().includes('input_audio_buffer.commit'))
    assert.equal(h.socket().types().at(-1), 'input_audio_buffer.clear')
  })

  it('stops the voice when you press to talk over it', async () => {
    const h = walkie()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.output_audio.delta', delta: 'UklG' })
    h.call.talk(true)

    assert.ok(h.log.includes('flush'))
    assert.ok(h.socket().types().includes('response.cancel'))
    assert.equal(h.call.snapshot().speaking, 'you')
  })

  it('puts the line down once nothing is going on, so the wait costs nothing; the call goes on', async () => {
    const h = walkie()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Check the backups"}' })
    h.socket().emit({ type: 'response.output_audio.delta', delta: 'UklG' })
    h.socket().emit({ type: 'response.done' })
    await tick()
    h.fire(PARK_MS)

    assert.equal(h.socket().closed, true)
    assert.equal(h.call.snapshot().line, 'parked')
    assert.equal(h.call.snapshot().phase, 'live')
    assert.equal(h.call.snapshot().tasks, 1)
    assert.ok(!h.log.includes('stop'))
  })

  it('picks the line up again to say a result, with the call so far, then says it', async () => {
    const h = walkie()

    await live(h)
    h.socket().emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Are the backups fine?' })
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Check the backups"}' })
    h.socket().emit({ type: 'response.output_audio.delta', delta: 'UklG' })
    h.socket().emit({ type: 'response.done' })
    await tick()
    h.fire(PARK_MS)
    assert.equal(h.call.snapshot().line, 'parked')

    h.call.result('All three ran last night.')
    await tick()
    await tick()
    assert.equal(h.sockets.length, 2)
    assert.deepEqual(h.latest().protocols, ['xai-client-secret.secret-2'])
    assert.equal(h.call.snapshot().line, 'opening')

    h.latest().onopen?.()
    const session = h.latest().sent[0]?.session as Record<string, unknown>

    assert.equal(session.turn_detection, null)
    assert.match(String(session.instructions), /picked up again[\s\S]*You: Are the backups fine\?/)
    assert.deepEqual(h.latest().types(), ['session.update', 'conversation.item.create', 'response.create'])
    assert.match(JSON.stringify(h.latest().sent[1]), /\[Hermes result\] All three ran last night\./)
    assert.equal(h.call.snapshot().line, 'open')
  })

  it('keeps what you say while the line is picked up, and sends it once it is open, even if you let go first', async () => {
    const h = walkie()

    await live(h)
    h.fire(PARK_MS)
    assert.equal(h.call.snapshot().line, 'parked')

    h.call.talk(true)
    h.speak('AAAA')
    h.speak('BBBB')
    h.later(1200)
    h.call.talk(false)
    await tick()
    await tick()
    h.latest().onopen?.()

    assert.deepEqual(h.latest().types(), ['session.update', 'input_audio_buffer.append', 'input_audio_buffer.append', 'input_audio_buffer.commit'])
  })

  it('lets results wait while you talk', async () => {
    const h = walkie()

    await live(h)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.function_call_arguments.done', name: 'hermes_task', call_id: 'call-1', arguments: '{"request":"Check"}' })
    h.socket().emit({ type: 'response.done' })
    await tick()
    h.call.talk(true)
    h.call.result('Done.')

    assert.ok(!JSON.stringify(h.socket().sent).includes('Done.'))

    h.later(1000)
    h.call.talk(false)
    h.socket().emit({ type: 'response.created' })
    h.socket().emit({ type: 'response.done' })
    assert.match(JSON.stringify(h.socket().sent), /\[Hermes result\] Done\./)
  })

  it('treats xAI putting the line down as a pause, not the end of the call', async () => {
    const h = walkie()

    await live(h)
    h.socket().onclose?.({ code: 1000, reason: 'idle' })

    assert.equal(h.call.snapshot().phase, 'live')
    assert.equal(h.call.snapshot().line, 'parked')
  })
})
