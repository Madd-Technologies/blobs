import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SocketLike } from '../call/engine.ts'
import { base64ToBytes, pcmToBase64 } from './audio.ts'
import { createListen, type ListenSnapshot } from './listen.ts'

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }
  close() {
    this.closed = true
  }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

function harness(options: { join?: boolean; ticketFails?: boolean } = {}) {
  const socket = new FakeSocket()
  const played: string[] = []
  const snaps: ListenSnapshot[] = []
  let mic: ((pcm: string) => void) | null = null
  const audio = { started: false, stopped: false, flushed: 0 }
  const connected: { url: string; protocols: string[] }[] = []
  const listen = createListen(
    {
      ticket: async () => {
        if (options.ticketFails) {
          throw new Error('The call isn’t on the line.')
        }

        return { url: 'wss://node.example.ts.net:8443/app/listen', protocols: ['hermes-phone.listen', 'ticket.abc'] }
      },
      connect: (url, protocols) => {
        connected.push({ url, protocols })

        return socket
      },
      audio: {
        start: async onFrame => {
          audio.started = true
          mic = onFrame
        },
        play: pcm => played.push(pcm),
        flush: () => audio.flushed++,
        stop: () => {
          audio.stopped = true
        },
      },
      onChange: snap => snaps.push(snap),
    },
    { join: options.join },
  )

  return { listen, socket, played, snaps, audio, connected, speak: (pcm: string) => mic?.(pcm) }
}

const loudFrame = pcmToBase64(new Int16Array(2400).fill(6000))

describe('listening in', () => {
  it('opens with the ticket and plays both sides at 24 kHz', async () => {
    const h = harness()
    await h.listen.start()
    assert.equal(h.audio.started, true)
    assert.deepEqual(h.connected[0]?.protocols, ['hermes-phone.listen', 'ticket.abc'])
    h.socket.receive({ type: 'hello', mode: 'voice', started: 100, ends: 1300 })
    assert.equal(h.listen.snapshot().phase, 'listening')
    assert.equal(h.listen.snapshot().ends, 1300)
    h.socket.receive({ type: 'audio', pcmu: btoa(String.fromCharCode(...new Array(800).fill(0xff))) })
    assert.equal(base64ToBytes(h.played[0]!).length, 800 * 3 * 2)
    h.speak(loudFrame)
    assert.equal(h.socket.sent.length, 0) // your microphone stays with you while you only listen
  })

  it('keeps the transcript as it grows and is refined', async () => {
    const h = harness()
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'voice' })
    h.socket.receive({ type: 'lines', from: 0, lines: [{ who: 'assistant', text: 'Hi', t: 1 }, { who: 'them', text: 'Hel', t: 2 }] })
    h.socket.receive({ type: 'lines', from: 1, lines: [{ who: 'them', text: 'Hello there', t: 2 }] })
    assert.deepEqual(
      h.listen.snapshot().lines.map(line => line.text),
      ['Hi', 'Hello there'],
    )
  })

  it('takes over, sends your microphone only while you have the line, and hands back with a note', async () => {
    const h = harness()
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'voice' })
    h.listen.takeOver()
    assert.deepEqual(h.socket.sent.at(-1), { type: 'take_over' })
    assert.equal(h.listen.snapshot().joining, true)
    h.socket.receive({ type: 'state', mode: 'handover' })
    h.speak(loudFrame)
    assert.equal(h.socket.sent.length, 1) // not yet: the voice is still putting you on
    h.socket.receive({ type: 'state', mode: 'owner' })
    assert.equal(h.listen.snapshot().joining, false)
    h.speak(loudFrame)
    const audio = h.socket.sent.at(-1)!
    assert.equal(audio.type, 'audio')
    assert.equal(base64ToBytes(String(audio.pcmu)).length, 800)
    h.listen.setMuted(true)
    h.speak(loudFrame)
    assert.equal(h.socket.sent.at(-1), audio)
    h.listen.handBack('  Thursday works.  ')
    assert.deepEqual(h.socket.sent.at(-1), { type: 'hand_back', note: 'Thursday works.' })
    assert.equal(h.audio.flushed, 1)
  })

  it('joins straight away from "Join the call"', async () => {
    const h = harness({ join: true })
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'checking' })
    assert.deepEqual(h.socket.sent, [{ type: 'take_over' }])
    assert.equal(h.listen.snapshot().joining, true)
  })

  it('says why it could not join', async () => {
    const h = harness()
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'voice' })
    h.listen.takeOver()
    h.socket.receive({ type: 'refused', message: 'The call can’t be joined right now.' })
    assert.equal(h.listen.snapshot().joining, false)
    assert.equal(h.listen.snapshot().note, 'The call can’t be joined right now.')
  })

  it('ends with the call, on a dropped socket, or when you leave (handing back first)', async () => {
    let h = harness()
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'voice' })
    h.socket.receive({ type: 'end' })
    assert.equal(h.listen.snapshot().phase, 'ended')
    assert.equal(h.audio.stopped, true)
    assert.equal(h.socket.closed, true)

    h = harness()
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'owner' })
    h.socket.onclose?.({ code: 1006 })
    assert.match(h.listen.snapshot().note ?? '', /voice takes the call back/)

    h = harness()
    await h.listen.start()
    h.socket.receive({ type: 'hello', mode: 'owner' })
    h.listen.leave()
    assert.deepEqual(h.socket.sent, [{ type: 'hand_back', note: '' }, { type: 'leave' }])
    assert.equal(h.listen.snapshot().note, null)
  })

  it('a refused ticket ends it with the reason', async () => {
    const h = harness({ ticketFails: true })
    await h.listen.start()
    assert.equal(h.listen.snapshot().phase, 'ended')
    assert.equal(h.listen.snapshot().note, 'The call isn’t on the line.')
    assert.equal(h.audio.stopped, true)
  })
})
