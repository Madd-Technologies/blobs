/**
 * Phone errands (the optional hermes-phone plugin): a bot researches, writes a call brief, you approve it here, and a
 * separate voice that knows only the brief calls other people through your own Twilio number. These are the plugin's
 * dashboard routes, under `/api/plugins/hermes-phone/`. Pure apart from the fetches.
 */

import { isAbsent } from './plugins.ts'
import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

const BASE = '/api/plugins/hermes-phone'
const MS = 10_000

export type ErrandStatus = 'pending' | 'approved' | 'running' | 'done' | 'declined' | 'cancelled' | 'expired'
export type CallStatus = 'waiting' | 'dialing' | 'ringing' | 'live' | 'done' | 'failed' | 'skipped' | 'cancelled'
/** What a call came to, from the voice's `record_outcome` (or the service, for one nobody answered). */
export type OutcomeStatus = 'done' | 'quoted' | 'booked' | 'call_back' | 'declined' | 'no_answer' | 'wrong_number'
/** Quotes only (never books), may book within `accept`, or asks / passes on a message. */
export type Mode = 'quote' | 'book' | 'ask'

/** A fact the other party may hear. */
export interface Fact {
  label: string
  value: string
  /** Said as "we think". */
  estimate: boolean
  only_if_asked: boolean
}

/** One field every call in the errand writes down, so the answers compare line by line. */
export interface RecordField {
  key: string
  label: string
}

/** Someone to call, with where the bot found the number and why it picked them (shown to you, never to the call). */
export interface BriefCall {
  name: string
  number: string
  source: string
  why: string
}

/** Everything the voice on a call will know, plus the bot's research notes, which stay with you. */
export interface Brief {
  title: string
  mode: Mode
  goal: string
  /** The bot's part of the opening, said after the fixed disclosure. Empty: "I'm calling about <title>." */
  opening: string
  facts: Fact[]
  questions: string[]
  record: RecordField[]
  /** For a booking call: what it may agree to. */
  accept: string
  /** The bot's research notes: shown to you, never sent to a call. */
  notes: string
  calls: BriefCall[]
}

/** A fact that needs your tick before any call (it is on your never-share list, or is an address, a number, an email…). */
export interface Flag {
  /** Index into the brief's facts as sent. */
  fact: number
  label: string
  why: string
}

/** What a call came to. The brief's record keys hold what they said. */
export interface Outcome {
  status: OutcomeStatus | (string & {})
  open_questions?: string
  /** Anything they asked you (or the bot) to do. The bot never acts on it by itself. */
  they_asked?: string
  notes?: string
  dont_call_again?: boolean
  [key: string]: unknown
}

export interface TranscriptLine {
  who: 'assistant' | 'them' | (string & {})
  text: string
  /** Seconds into the call. */
  t: number
}

export type AskKind = 'question' | 'approval'

/** A question a live call is holding for you (`ask_owner`), or (hermes-phone 0.2+) an approval of something outside the brief. */
export interface CallQuestion {
  /** 0.2+: the ask's random id; an answer can be pinned to it. */
  id?: string
  kind?: AskKind
  text: string
  /** 0.2+: up to three short answers to pick from (a question only). */
  choices?: string[]
  /** Server clock, seconds. */
  asked: number
  /** 0.2+: when the voice stops waiting (longer while you listen in). Before: a minute after `asked`. */
  deadline?: number
  answer: string | null
  /** 0.2+: Allow (true) or Deny (false) for an approval. */
  approved?: boolean | null
}

/** How an ask ended (0.2+). `joined`: you took the call over instead. */
export type AskHow = 'answered' | 'allowed' | 'denied' | 'no_answer' | 'joined'

export interface CallAnswer {
  question: string
  answer: string | null
  asked?: number
  kind?: AskKind
  how?: AskHow
}

/** What you (or the voice, asking you) did on a call, newest last (0.2+). */
export interface CallLogEntry {
  t: number
  what: 'asked' | 'asked_ok' | AskHow | 'listen' | 'took_over' | 'handed_back' | 'dropped' | 'stopped_listening' | (string & {})
  text?: string
}

/** Who has this side of a live call (0.2+): the voice, on hold, checking with you, handing over to you, or you. */
export type CallMode = 'voice' | 'hold' | 'checking' | 'handover' | 'owner'

export interface Call {
  id: string
  /** Its place in the brief's calls (after any struck at approval). */
  index: number
  name: string
  number: string
  status: CallStatus
  /** `human` or `machine` once the call knows. */
  answered_by: string
  started: number | null
  ended: number | null
  outcome: Outcome | null
  /** Empty when transcripts are off. */
  transcript: TranscriptLine[]
  question: CallQuestion | null
  answers: CallAnswer[]
  /** A hang-up was asked for and is on its way. */
  hangup: boolean
  error: string
  /** On hold (hold music, a menu, a recording). */
  hold: boolean
  /** 0.2+: who has the line now, as last saved (the listen socket says it live). */
  mode?: CallMode | ''
  /** 0.2+ */
  log?: CallLogEntry[]
}

export interface Errand {
  id: string
  profile: string
  session_id: string
  /** Server clock, seconds. */
  created: number
  status: ErrandStatus
  brief: Brief
  flags: Flag[]
  ticked: number[]
  decided: { at: number; by: string; hash?: string } | null
  calls: Call[]
  /** Why the calls are not going right now (calling hours, the daily cap, no line). */
  problem?: string
  finished?: number
}

/** A row of `GET /errands`. */
export interface ErrandRow {
  id: string
  profile: string
  title: string
  status: ErrandStatus
  created: number
  calls: number
  flags: number
  problem: string
  question: CallQuestion | null
}

export interface PhoneStatus {
  version: string
  service: { running: boolean; live: number }
  /** The Twilio line: its number shown as its last two digits only. */
  line: { set: boolean; number: string }
  public_url: boolean
  stage: 'test' | 'live'
  /** 0.2+: `ask_kinds` (choices and approvals), `listen` (listen in and take over). */
  features?: string[]
}

/** A never-share entry as the server shows it: the value is never sent back, only its last two characters. */
export interface NeverShare {
  label: string
  hint: string
}

export interface PhoneSettings {
  /** The name the voice gives ("calling for Alex"). */
  name: string
  /**
   * The call's first sentence, spoken word for word before the reason for the call; "" for the standard one (it says it
   * is an AI and, with transcripts, that the call is transcribed). hermes-phone 0.1.3+; older ones leave it out.
   */
  opener?: string
  never_share: NeverShare[]
  do_not_call: string[]
  /** Profiles that may make calls. */
  bots: string[]
  stage: 'test' | 'live'
  /** In the test stage, the only numbers it calls. */
  test_numbers: string[]
  /** Calling hours [start, end), in the server's local time. */
  hours: [number, number]
  daily_cap: number
  max_minutes: number
  hold_minutes: number
  callback_days: number
  transcripts: boolean
  ask_owner: boolean
  public_url: string
  port: number
}

export type SettingsChange = Partial<Omit<PhoneSettings, 'never_share'>> & {
  never_share_add?: { label: string; value: string }[]
  never_share_remove?: string[]
}

export interface ApproveEdits {
  /** Flagged facts you ticked, as indexes into the brief as sent. */
  ticked: number[]
  remove_facts: number[]
  remove_calls: number[]
}

/** The plugin's own refusal: unticked, decided, no_line, invalid, not_running, not_on_a_call, late, unknown. */
export class PhoneRefusal extends Error {
  readonly reason: string
  readonly status: number

  constructor(reason: string, message: string, status: number) {
    super(message)
    this.name = 'PhoneRefusal'
    this.reason = reason
    this.status = status
  }
}

/** The plugin answers `{"detail": {"reason", "message"}}`. */
export function phoneRefusal(error: unknown): PhoneRefusal | null {
  if (!(error instanceof HermesHttpError)) {
    return null
  }

  const body = error.body || error.message.slice(Math.max(0, error.message.indexOf('{')))

  try {
    const detail = (JSON.parse(body) as { detail?: { reason?: unknown; message?: unknown } }).detail

    return typeof detail?.reason === 'string' && typeof detail.message === 'string' ? new PhoneRefusal(detail.reason, detail.message, error.status) : null
  } catch {
    return null
  }
}

const isErrand = (value: unknown): value is Errand => {
  const v = value as Errand | null

  return !!v && typeof v.id === 'string' && typeof v.status === 'string' && !!v.brief && Array.isArray(v.brief.facts) && Array.isArray(v.calls)
}

function errandOrThrow(answer: unknown): Errand {
  if (!isErrand(answer)) {
    throw new Error('The server gave an unexpected answer.')
  }

  return answer
}

async function call<T>(config: ServerConfig, path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await restJson<T>(config, `${BASE}${path}`, init, { timeoutMs: MS })
  } catch (error) {
    throw phoneRefusal(error) ?? error
  }
}

/** The plugin's status, or null when the server has no hermes-phone. */
export async function getPhoneStatus(config: ServerConfig): Promise<PhoneStatus | null> {
  try {
    const status = await restJson<PhoneStatus>(config, `${BASE}/status`, {}, { timeoutMs: MS })

    return typeof status?.version === 'string' && !!status.service && !!status.line ? status : null
  } catch (error) {
    if (isAbsent(error)) {
      return null
    }

    throw error
  }
}

export function getPhoneSettings(config: ServerConfig): Promise<PhoneSettings> {
  return call<PhoneSettings>(config, '/settings')
}

/** Changes settings; never-share values go in `never_share_add` and are never read back. Answers the settings as they are now. */
export function setPhoneSettings(config: ServerConfig, change: SettingsChange): Promise<PhoneSettings> {
  return call<PhoneSettings>(config, '/settings', { method: 'PUT', body: JSON.stringify(change) })
}

/** The newest errands (50 at most), every status. */
export async function listErrands(config: ServerConfig): Promise<ErrandRow[]> {
  const answer = await call<{ errands?: unknown }>(config, '/errands')

  return Array.isArray(answer?.errands) ? (answer.errands as ErrandRow[]).filter(row => typeof row?.id === 'string') : []
}

export async function getErrand(config: ServerConfig, id: string): Promise<Errand> {
  return errandOrThrow(await call<unknown>(config, `/errands/${encodeURIComponent(id)}`))
}

/** The only way an errand gets dialed: every flag ticked or struck. Answers the approved errand. */
export async function approveErrand(config: ServerConfig, id: string, edits: ApproveEdits): Promise<Errand> {
  return errandOrThrow(await call<unknown>(config, `/errands/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify(edits) }))
}

export async function declineErrand(config: ServerConfig, id: string): Promise<Errand> {
  return errandOrThrow(await call<unknown>(config, `/errands/${encodeURIComponent(id)}/decline`, { method: 'POST', body: '{}' }))
}

/** Stops the calls not made yet and hangs up a live one. */
export async function cancelErrand(config: ServerConfig, id: string): Promise<Errand> {
  return errandOrThrow(await call<unknown>(config, `/errands/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }))
}

export async function hangUpCall(config: ServerConfig, errandId: string, callId: string): Promise<Errand> {
  return errandOrThrow(await call<unknown>(config, `/errands/${encodeURIComponent(errandId)}/calls/${encodeURIComponent(callId)}/hangup`, { method: 'POST', body: '{}' }))
}

/** An answer to what a live call holds: typed text, one of its choices, or Allow / Deny. `ask` pins it to that one question. */
export type CallReply = ({ text: string } | { choice: string } | { approved: boolean }) & { ask?: string }

/**
 * Answers the question a live call is holding. The server screens text like a brief (refusal `not_on_a_call`), and refuses a
 * late one or one for another question (`late`).
 */
export async function answerCall(config: ServerConfig, errandId: string, callId: string, reply: CallReply | string): Promise<Errand> {
  const body = typeof reply === 'string' ? { text: reply } : reply

  return errandOrThrow(await call<unknown>(config, `/errands/${encodeURIComponent(errandId)}/calls/${encodeURIComponent(callId)}/answer`, { method: 'POST', body: JSON.stringify(body) }))
}

/** A single-use ticket (30 s) for the call service's listen socket: open `url` with `protocols`, and never log either. */
export interface ListenTicket {
  url: string
  protocols: string[]
  expires: number
}

export async function listenTicket(config: ServerConfig, errandId: string, callId: string): Promise<ListenTicket> {
  const answer = await call<Partial<ListenTicket>>(config, `/errands/${encodeURIComponent(errandId)}/calls/${encodeURIComponent(callId)}/listen`, { method: 'POST', body: '{}' })

  if (typeof answer?.url !== 'string' || !answer.url.startsWith('wss://') || !Array.isArray(answer.protocols)) {
    throw new Error('The server gave an unexpected answer.')
  }

  return { url: answer.url, protocols: answer.protocols.map(String), expires: Number(answer.expires) || 30 }
}

/** Whether the server's hermes-phone offers a feature (0.2+). */
export const phoneHas = (status: Pick<PhoneStatus, 'features'> | null | undefined, feature: 'ask_kinds' | 'listen'): boolean => !!status?.features?.includes(feature)
