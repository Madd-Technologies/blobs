/**
 * A phone errand's audio for listening in and taking over: the call service speaks 8 kHz G.711 μ-law (a phone line's own
 * audio), and the phone's call-audio module speaks 16-bit PCM at 24 kHz. Pure, so it runs in the tests; small enough to run
 * on every 100 ms frame in JS.
 *
 * - Down (what you hear): μ-law → PCM, then ×3 by linear interpolation, carried across frames so chunk edges don't click.
 * - Up (your microphone): PCM at 24 kHz → the mean of each three samples (a crude low-pass that is plenty for a voice on a
 *   phone line) → μ-law.
 */

const BIAS = 0x84
const CLIP = 32635

function decodeSample(byte: number): number {
  const inverted = ~byte & 0xff
  const sign = inverted & 0x80
  const exponent = (inverted >> 4) & 7
  const mantissa = inverted & 0x0f
  const sample = (((mantissa << 3) + BIAS) << exponent) - BIAS

  return sign && sample ? -sample : sample
}

/** μ-law byte → 16-bit sample, the same table as the call service's `ulaw.py`. */
export const ULAW_DECODE: readonly number[] = Array.from({ length: 256 }, (_, byte) => decodeSample(byte))

/** 16-bit sample → μ-law byte. */
export function encodeSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0
  const magnitude = Math.min(Math.abs(Math.trunc(sample)), CLIP) + BIAS
  const exponent = Math.min(7, Math.max(0, 31 - Math.clz32(magnitude >> 7)))
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f

  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(binary)
}

/** 16-bit little-endian PCM, as base64, both ways. */
export function pcmFromBase64(base64: string): Int16Array {
  const bytes = base64ToBytes(base64)
  const samples = new Int16Array(bytes.length >> 1)

  for (let i = 0; i < samples.length; i++) {
    samples[i] = (bytes[2 * i]! | (bytes[2 * i + 1]! << 8)) << 16 >> 16
  }

  return samples
}

export function pcmToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2)

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]!
    bytes[2 * i] = value & 0xff
    bytes[2 * i + 1] = (value >> 8) & 0xff
  }

  return bytesToBase64(bytes)
}

/** What you hear: μ-law at 8 kHz (base64) → PCM at 24 kHz (base64). Keeps the last sample, so frames join smoothly. */
export function createDownlink(): (pcmu: string) => string {
  let previous = 0

  return pcmu => {
    const bytes = base64ToBytes(pcmu)
    const out = new Int16Array(bytes.length * 3)

    for (let i = 0; i < bytes.length; i++) {
      const next = ULAW_DECODE[bytes[i]!]!
      out[3 * i] = Math.round(previous + (next - previous) / 3)
      out[3 * i + 1] = Math.round(previous + (2 * (next - previous)) / 3)
      out[3 * i + 2] = next
      previous = next
    }

    return pcmToBase64(out)
  }
}

/** Your microphone: PCM at 24 kHz (base64) → μ-law at 8 kHz (base64). Keeps a leftover sample or two between frames. */
export function createUplink(): (pcm: string) => string {
  let carry: number[] = []

  return pcm => {
    const samples = [...carry, ...pcmFromBase64(pcm)]
    const whole = samples.length - (samples.length % 3)
    const out = new Uint8Array(whole / 3)

    for (let i = 0; i < whole; i += 3) {
      out[i / 3] = encodeSample((samples[i]! + samples[i + 1]! + samples[i + 2]!) / 3)
    }

    carry = samples.slice(whole)

    return bytesToBase64(out)
  }
}
