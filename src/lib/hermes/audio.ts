/**
 * Voice messages: record on the phone, have the server turn it into text. Pure: no React Native imports.
 *
 * `POST /api/audio/transcribe` takes the recording as a base64 data URL and answers with the text, using the speech
 * recognition the chosen bot's profile has set up. The server's own `voice.record` listens on the *server's*
 * microphone, so it is no use from a phone.
 */

import { restJson, type ServerConfig } from './server.ts'

/** The server refuses recordings over this (25 MB; a few minutes of speech is well under 1 MB). */
export const MAX_RECORDING_BYTES = 25 * 1024 * 1024

export interface Transcript {
  /** Empty when nothing was heard (silence is a normal result, not an error). */
  text: string
  provider: string | null
}

/** `audio/m4a`: what both phones' high-quality recordings are (AAC in an MPEG-4 container). */
export const RECORDING_MIME = 'audio/m4a'

export async function transcribeRecording(config: ServerConfig, base64: string, options: { profile?: string; mime?: string } = {}): Promise<Transcript> {
  const mime = options.mime ?? RECORDING_MIME
  const query = options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''
  const body = await restJson<{ ok?: boolean; transcript?: string; provider?: string | null }>(config, `/api/audio/transcribe${query}`, {
    method: 'POST',
    body: JSON.stringify({ data_url: `data:${mime};base64,${base64}`, mime_type: mime }),
  })

  return { text: (body.transcript ?? '').trim(), provider: body.provider ?? null }
}

/** `0:07`, `1:05`. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Your words, then what was said, on a new line when there is something already in the box. */
export function appendTranscript(existing: string, transcript: string): string {
  const said = transcript.trim()

  if (!said) {
    return existing
  }

  return existing.trim() ? `${existing.replace(/\s+$/, '')}\n${said}` : said
}
