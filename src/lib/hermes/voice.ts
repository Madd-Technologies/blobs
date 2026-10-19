/**
 * Voice calls (the optional hermes-voice plugin): each bot's call settings, kept on the server. During a call the phone
 * talks to xAI itself with a one-time secret the server makes from its Grok sign-in or the bot's own xAI key. Pure apart
 * from the fetches.
 */

import { isAbsent } from './plugins.ts'
import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

const BASE = '/api/plugins/hermes-voice'

export const VOICES = [
  { value: 'eve', label: 'Eve' },
  { value: 'ara', label: 'Ara' },
  { value: 'rex', label: 'Rex' },
  { value: 'sal', label: 'Sal' },
  { value: 'leo', label: 'Leo' },
] as const

export type VoiceName = (typeof VOICES)[number]['value']
export type VoiceAccount = 'sign-in' | 'key'

/** A bot's call settings as the server shows them. */
export interface BotVoice {
  enabled: boolean
  voice: VoiceName
  /** Which account pays for its calls. A bot never set uses the sign-in when the server has one, otherwise its key. */
  account: VoiceAccount
  available: { sign_in: boolean; key: boolean }
  /** The chosen account is there, so a call can start. */
  ready: boolean
  model: string
}

export interface VoiceChange {
  enabled?: boolean
  voice?: VoiceName
  account?: VoiceAccount
}

/** The plugin's own refusal, with its reason (off, no_sign_in, no_key, rejected, unreachable, invalid, unknown_bot). */
export class VoiceRefusal extends Error {
  readonly reason: string
  readonly status: number

  constructor(reason: string, message: string, status: number) {
    super(message)
    this.name = 'VoiceRefusal'
    this.reason = reason
    this.status = status
  }
}

/** The plugin answers `{"detail": {"reason", "message"}}`; restJson keeps the start of that body in its message. */
export function voiceRefusal(error: unknown): VoiceRefusal | null {
  if (!(error instanceof HermesHttpError)) {
    return null
  }

  const start = error.message.indexOf('{')

  try {
    const detail = (JSON.parse(error.message.slice(start)) as { detail?: { reason?: unknown; message?: unknown } }).detail

    return start >= 0 && typeof detail?.reason === 'string' && typeof detail.message === 'string' ? new VoiceRefusal(detail.reason, detail.message, error.status) : null
  } catch {
    return null
  }
}

function isBotVoice(value: unknown): value is BotVoice {
  const v = value as BotVoice | null

  return !!v && typeof v.enabled === 'boolean' && typeof v.voice === 'string' && (v.account === 'sign-in' || v.account === 'key') && typeof v.available === 'object' && !!v.available
}

const at = (profile: string) => `${BASE}/bot?profile=${encodeURIComponent(profile)}`

/** A bot's call settings, or null when the server has no hermes-voice. */
export async function getBotVoice(config: ServerConfig, profile: string): Promise<BotVoice | null> {
  try {
    const answer = await restJson<unknown>(config, at(profile), {}, { timeoutMs: 8000 })

    return isBotVoice(answer) ? answer : null
  } catch (error) {
    // The plugin's own 404 (a bot it doesn't know) has a reason; a 404 without one means the plugin isn't there.
    const refusal = voiceRefusal(error)

    if (refusal) {
      throw refusal
    }

    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}

/** Changes a bot's call settings; answers them as they are now. */
export async function setBotVoice(config: ServerConfig, profile: string, change: VoiceChange): Promise<BotVoice> {
  try {
    const answer = await restJson<unknown>(config, at(profile), { method: 'PUT', body: JSON.stringify(change) }, { timeoutMs: 8000 })

    if (!isBotVoice(answer)) {
      throw new Error('The server gave an unexpected answer.')
    }

    return answer
  } catch (error) {
    throw voiceRefusal(error) ?? error
  }
}

export const voiceLabel = (voice: string): string => VOICES.find(v => v.value === voice)?.label ?? voice

export const accountLabel = (account: VoiceAccount): string => (account === 'sign-in' ? 'Grok sign-in' : 'This bot’s xAI key')

/** The Voice row's value in a bot's details. */
export function voiceLine(voice: BotVoice): string {
  if (!voice.enabled) {
    return 'Off'
  }

  return voice.ready ? voiceLabel(voice.voice) : 'Not set up'
}

/** One line under an account choice: what it costs, or what is missing. */
export function accountHint(account: VoiceAccount, voice: BotVoice): string {
  if (account === 'sign-in') {
    return voice.available.sign_in ? 'Included in your Grok plan, within its limits.' : 'This server has no Grok sign-in.'
  }

  return voice.available.key ? 'Billed to the key’s xAI team, about $0.08 a minute.' : 'This bot has no XAI_API_KEY yet. Add one in its Keys.'
}

export const PRIVACY_NOTE =
  'During a call your voice goes straight to xAI. Calls on the Grok sign-in follow your Grok account’s data settings. With a key from an xAI team that has zero data retention on, xAI keeps nothing.'
