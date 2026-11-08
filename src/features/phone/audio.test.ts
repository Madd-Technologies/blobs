import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { base64ToBytes, bytesToBase64, createDownlink, createUplink, encodeSample, pcmFromBase64, pcmToBase64, ULAW_DECODE } from './audio.ts'

describe('μ-law', () => {
  it('decodes as the call service does, and silence is near zero', () => {
    assert.equal(ULAW_DECODE[0xff], 0)
    assert.equal(ULAW_DECODE[0x7f], 0)
    assert.equal(ULAW_DECODE[0x00], -32124)
    assert.equal(ULAW_DECODE[0x80], 32124)
  })

  it('encodes every byte back to itself', () => {
    for (let byte = 0; byte < 256; byte++) {
      const back = encodeSample(ULAW_DECODE[byte]!)
      // 0x7f and 0xff both mean zero.
      assert.equal(ULAW_DECODE[back], ULAW_DECODE[byte], `byte ${byte}`)
    }
  })

  it('clips past the loudest sample', () => {
    assert.equal(ULAW_DECODE[encodeSample(40_000)], 32124)
    assert.equal(ULAW_DECODE[encodeSample(-40_000)], -32124)
  })
})

describe('PCM and base64', () => {
  it('round-trips little-endian samples', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234])
    assert.deepEqual([...pcmFromBase64(pcmToBase64(samples))], [...samples])
    assert.deepEqual([...base64ToBytes(bytesToBase64(Uint8Array.from([0, 255, 7])))], [0, 255, 7])
  })
})

describe('the downlink', () => {
  it('makes 24 kHz from 8 kHz, three samples for one, joined across frames', () => {
    const down = createDownlink()
    const loud = encodeSample(9000)
    const first = pcmFromBase64(down(bytesToBase64(Uint8Array.from([loud, loud]))))
    assert.equal(first.length, 6)
    assert.deepEqual([first[0], first[1]].map(v => Math.sign(v!)), [1, 1]) // rising from silence toward the sample
    assert.ok(first[0]! < first[2]!)
    assert.equal(first[2], ULAW_DECODE[loud])
    const next = pcmFromBase64(down(bytesToBase64(Uint8Array.from([0xff]))))
    assert.ok(next[0]! > 0 && next[0]! < first[5]!) // falls from where the last frame ended
    assert.equal(next[2], 0)
  })
})

describe('the uplink', () => {
  it('makes 8 kHz μ-law from 24 kHz PCM, carrying what doesn’t divide by three', () => {
    const up = createUplink()
    const pcm = new Int16Array(2400).fill(8000)
    const bytes = base64ToBytes(up(pcmToBase64(pcm)))
    assert.equal(bytes.length, 800)
    assert.ok(Math.abs(ULAW_DECODE[bytes[0]!]! - 8000) < 300)
    assert.equal(base64ToBytes(up(pcmToBase64(new Int16Array(4).fill(8000)))).length, 1)
    assert.equal(base64ToBytes(up(pcmToBase64(new Int16Array(2).fill(8000)))).length, 1) // 1 carried + 2
  })
})
