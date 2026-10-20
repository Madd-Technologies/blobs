/**
 * Phone errands as the app shows them: the request card's lines and what Approve sends, each call's quiet line, the
 * results side by side, a call's transcript, and what waits on you. Pure.
 */

import type { ApproveEdits, Brief, Call, CallAnswer, CallQuestion, Errand, ErrandStatus, Flag, PhoneSettings, RecordField } from '../../lib/hermes/phone.ts'

/** How long a live call holds a question for your answer (the service's QUESTION_WAIT_S). */
export const QUESTION_S = 60

/** Errands still going somewhere: waiting for your OK, approved, or calling. */
export const OPEN: readonly ErrandStatus[] = ['pending', 'approved', 'running']

/** A finished errand that asked something of you stays in Needs you this long, unless you mark it done. */
export const ASKED_DAYS = 7

export const isOpen = (errand: Pick<Errand, 'status'>): boolean => OPEN.includes(errand.status)

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** m:ss, or h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')

  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

/** A US or Canadian number as people write it; anything else as it came. */
export function formatNumber(number: string): string {
  const digits = number.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits

  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : number
}

// ── the request card ─────────────────────────────────────────────────────────────────────────────

/** The opening, as the call says it word for word: the fixed disclosure (your name), then the bot's own words. */
export function spokenOpening(brief: Pick<Brief, 'opening' | 'title'>, name: string, transcribed: boolean): { fixed: string; own: string } {
  const fixed = `Hi, this is an AI assistant calling for ${name || 'you'}.${transcribed ? ' This call is transcribed.' : ''}`
  const title = brief.title.trim()
  const own = brief.opening.trim() || `I’m calling about ${title.slice(0, 1).toLowerCase()}${title.slice(1)}.`

  return { fixed, own }
}

/** One sentence for what the call may do. */
export function modeLine(brief: Pick<Brief, 'mode' | 'accept'>): string {
  switch (brief.mode) {
    case 'book':
      return brief.accept ? `May book: ${brief.accept} · never agrees to a price` : 'May book · never agrees to a price'
    case 'ask':
      return 'Asks or passes on a message · never books'
    default:
      return 'Quotes only · never books or agrees to a price'
  }
}

/** The marks on a fact, as the card says them. */
export function factMarks(fact: { estimate: boolean; only_if_asked: boolean }): string[] {
  return [...(fact.only_if_asked ? ['only if asked'] : []), ...(fact.estimate ? ['an estimate: said as “we think”'] : [])]
}

/** What you changed on the card before approving: indexes into the brief as it was sent. */
export interface Choices {
  ticked: number[]
  struckFacts: number[]
  struckCalls: number[]
}

export const NO_CHOICES: Choices = { ticked: [], struckFacts: [], struckCalls: [] }

/** Adds the index, or takes it out. */
export function toggle(list: readonly number[], index: number): number[] {
  return list.includes(index) ? list.filter(other => other !== index) : [...list, index].sort((a, b) => a - b)
}

/** The flagged facts still in the way: neither ticked nor struck. */
export function blockingFlags(errand: Pick<Errand, 'flags'>, choices: Choices): Flag[] {
  return errand.flags.filter(flag => !choices.ticked.includes(flag.fact) && !choices.struckFacts.includes(flag.fact))
}

export function callsLeft(errand: Pick<Errand, 'brief'>, choices: Choices): number {
  return errand.brief.calls.filter((_, index) => !choices.struckCalls.includes(index)).length
}

/** Approve is live only for a pending errand with every flag dealt with and someone left to call. */
export function canApprove(errand: Pick<Errand, 'status' | 'flags' | 'brief'>, choices: Choices): boolean {
  return errand.status === 'pending' && blockingFlags(errand, choices).length === 0 && callsLeft(errand, choices) > 0
}

/** What Approve sends. A struck fact needs no tick, so only kept ones are sent as ticked. */
export function approveEdits(errand: Pick<Errand, 'flags'>, choices: Choices): ApproveEdits {
  const unique = (list: readonly number[]) => [...new Set(list)].sort((a, b) => a - b)
  const flagged = new Set(errand.flags.map(flag => flag.fact))

  return {
    ticked: unique(choices.ticked.filter(index => flagged.has(index) && !choices.struckFacts.includes(index))),
    remove_facts: unique(choices.struckFacts),
    remove_calls: unique(choices.struckCalls),
  }
}

/** The card's own line about what is in the way, or about what you struck. */
export function gateLine(errand: Pick<Errand, 'flags' | 'brief'>, choices: Choices): { needsYou: boolean; text: string } | null {
  const blocking = blockingFlags(errand, choices)

  if (blocking.length) {
    const names = blocking.map(flag => flag.label.toLowerCase())

    return { needsYou: true, text: `Tick or strike the ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} to approve.` }
  }

  if (callsLeft(errand, choices) === 0) {
    return { needsYou: true, text: 'Every call is struck. Keep one, or decline.' }
  }

  const struck = choices.struckCalls.map(index => errand.brief.calls[index]?.name).filter((name): name is string => !!name)

  return struck.length ? { needsYou: false, text: `${struck.join(' and ')} won’t be called.` } : null
}

/** "Make 3 calls for you?" */
export function askLine(count: number): string {
  return `Make ${plural(count, 'call', 'calls')} for you?`
}

/** One line for an errand that waits for your OK, in the server's own words ("3 calls wait for your OK: …"). */
export function requestLine(errand: Pick<Errand, 'brief'>): string {
  const n = errand.brief.calls.length

  return `${n} ${n === 1 ? 'call waits' : 'calls wait'} for your OK: ${errand.brief.title}`
}

// ── a call's line ────────────────────────────────────────────────────────────────────────────────

export type LineIcon = 'wait' | 'spinner' | 'live' | 'hold' | 'ask' | 'check' | 'callback' | 'x' | 'voicemail' | 'slash' | 'hangup'

export interface CallLine {
  icon: LineIcon
  /** What it is doing or came to, after the name. */
  status: string
  /** On the line now: the name is drawn a little stronger. */
  live: boolean
}

function duration(call: Pick<Call, 'started' | 'ended'>): string {
  return call.started !== null && call.ended !== null ? clock(call.ended - call.started) : ''
}

const withDuration = (text: string, call: Pick<Call, 'started' | 'ended'>) => {
  const length = duration(call)

  return length ? `${text} · ${length}` : text
}

/** The question a live call holds for you, with the seconds left (by the server's clock, never below 0). */
export function openQuestion(call: Pick<Call, 'question' | 'status'>, nowS: number): (CallQuestion & { left: number }) | null {
  const question = call.question

  if (!question || question.answer || !['dialing', 'ringing', 'live'].includes(call.status)) {
    return null
  }

  return { ...question, left: Math.max(0, Math.min(QUESTION_S, Math.round(question.asked + QUESTION_S - nowS))) }
}

/** A call you hung up from the app: the service records it as a call back with this note. */
const hungUpByYou = (call: Pick<Call, 'outcome' | 'hangup'>): boolean => call.hangup && call.outcome?.notes === 'Hung up from the app.'

/** What a finished call came to, in a few words. */
export function outcomeWords(call: Pick<Call, 'outcome' | 'hangup'>): { icon: LineIcon; text: string } {
  const outcome = call.outcome

  if (!outcome) {
    return { icon: 'check', text: 'done' }
  }

  if (outcome.dont_call_again) {
    return { icon: 'slash', text: 'asked not to be called again' }
  }

  if (hungUpByYou(call)) {
    return { icon: 'hangup', text: 'you hung up' }
  }

  switch (outcome.status) {
    case 'quoted':
      return { icon: 'check', text: 'quoted' }
    case 'booked':
      return { icon: 'check', text: 'booked' }
    case 'call_back':
      return { icon: 'callback', text: 'call back' }
    case 'declined':
      return { icon: 'x', text: 'said no' }
    case 'wrong_number':
      return { icon: 'x', text: 'wrong number' }
    case 'no_answer':
      return outcome.notes === 'Left a voicemail.'
        ? { icon: 'voicemail', text: 'left a voicemail' }
        : outcome.notes === 'The line was busy.'
          ? { icon: 'x', text: 'busy' }
          : { icon: 'x', text: 'no answer' }
    default:
      return { icon: 'check', text: 'done' }
  }
}

/** A call's quiet line. `next`: the first one waiting, while another is on the line or about to be. */
export function callLine(call: Call, nowS: number, next = false): CallLine {
  switch (call.status) {
    case 'waiting':
      return { icon: 'wait', status: next ? 'next' : 'waiting', live: false }
    case 'dialing':
      return { icon: 'spinner', status: 'dialing', live: true }
    case 'ringing':
      return { icon: 'spinner', status: 'ringing', live: true }
    case 'live': {
      const question = openQuestion(call, nowS)
      const length = call.started !== null ? clock(nowS - call.started) : ''

      if (question) {
        return { icon: 'ask', status: `asks you · ${clock(question.left)}`, live: true }
      }

      return call.hold ? { icon: 'hold', status: length ? `on hold ${length}` : 'on hold', live: true } : { icon: 'live', status: length ? `live ${length}` : 'live', live: true }
    }
    case 'failed':
      return { icon: 'x', status: 'couldn’t be placed', live: false }
    case 'skipped':
      return { icon: 'slash', status: /test/i.test(call.error) ? 'skipped: not a test number' : 'skipped', live: false }
    case 'cancelled':
      return { icon: 'slash', status: 'not called', live: false }
    default: {
      const words = outcomeWords(call)

      return { icon: words.icon, status: withDuration(words.text, call), live: false }
    }
  }
}

/** The calls' lines in order, with the first waiting one marked next while the errand is calling. */
export function callLines(errand: Pick<Errand, 'calls' | 'status'>, nowS: number): { call: Call; line: CallLine }[] {
  const calling = errand.status === 'running' || errand.status === 'approved'
  const firstWaiting = calling ? errand.calls.find(call => call.status === 'waiting')?.id : undefined

  return errand.calls.map(call => ({ call, line: callLine(call, nowS, call.id === firstWaiting) }))
}

/** The call on the line (or being placed) now. */
export function activeCall(errand: Pick<Errand, 'calls'>): Call | undefined {
  return errand.calls.find(call => call.status === 'dialing' || call.status === 'ringing' || call.status === 'live')
}

/**
 * Whether an errand can still change without you: its calls are being made, or it was stopped and its last call is still
 * on the line until the call service hangs up. Such errands are read on every refresh and their clocks tick.
 */
export function inMotion(errand: Pick<Errand, 'status' | 'calls'>): boolean {
  return errand.status === 'approved' || errand.status === 'running' || !!activeCall(errand)
}

/** The tray's second line for the active call: "Live 2:14 · call 1 of 3". */
export function barLine(errand: Pick<Errand, 'calls'>, call: Call, nowS: number): string {
  const line = callLine(call, nowS)
  const place = errand.calls.length > 1 ? ` · call ${errand.calls.indexOf(call) + 1} of ${errand.calls.length}` : ''

  return `${line.status.slice(0, 1).toUpperCase()}${line.status.slice(1)}${place}`
}

// ── results ──────────────────────────────────────────────────────────────────────────────────────

const HEADLINE: Record<string, [string, string]> = {
  quoted: ['quote', 'quotes'],
  booked: ['booking', 'bookings'],
  call_back: ['call back', 'call backs'],
  hung_up: ['hung up', 'hung up'],
  declined: ['said no', 'said no'],
  no_answer: ['no answer', 'no answers'],
  wrong_number: ['wrong number', 'wrong numbers'],
  failed: ['couldn’t be placed', 'couldn’t be placed'],
  cancelled: ['not called', 'not called'],
  skipped: ['skipped', 'skipped'],
  done: ['done', 'done'],
}

/** "2 quotes, 1 call back": what the errand's calls came to. */
export function headline(errand: Pick<Errand, 'calls'>): string {
  const counts = new Map<string, number>()

  for (const call of errand.calls) {
    const key = call.status === 'done' ? (hungUpByYou(call) ? 'hung_up' : String(call.outcome?.status ?? 'done')) : call.status === 'failed' || call.status === 'cancelled' || call.status === 'skipped' ? call.status : 'waiting'

    if (key !== 'waiting') {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return [...counts].map(([key, n]) => plural(n, ...(HEADLINE[key] ?? [key.replace(/_/g, ' '), key.replace(/_/g, ' ')]))).join(', ')
}

/** What the call wrote down for each of the brief's fields, as text. */
export function recorded(record: readonly RecordField[], call: Pick<Call, 'outcome'>): { key: string; label: string; value: string }[] {
  return record.map(field => {
    const raw = call.outcome?.[field.key]

    return { key: field.key, label: field.label, value: raw === undefined || raw === null ? '' : String(raw).trim() }
  })
}

/** The calls side by side: one row per field, one column per call. Missing answers are '—'. */
export function compare(errand: Pick<Errand, 'brief' | 'calls'>): { rows: { label: string; values: string[] }[] } {
  return {
    rows: errand.brief.record.map(field => ({
      label: field.label,
      values: errand.calls.map(call => {
        const raw = call.outcome?.[field.key]
        const text = raw === undefined || raw === null ? '' : String(raw).trim()

        return text || '—'
      }),
    })),
  }
}

/** A short name for a column head: the first two words. */
export function shortName(name: string): string {
  return name.split(/\s+/).slice(0, 2).join(' ')
}

/** What calls asked you (or the bot) to do. The bot never acts on these by itself. */
export function theyAsked(errand: Pick<Errand, 'calls'>): { call: Call; text: string }[] {
  return errand.calls.flatMap(call => {
    const text = String(call.outcome?.they_asked ?? '').trim()

    return text ? [{ call, text }] : []
  })
}

/** A finished call's one-line summary for the list of calls: "Quoted · 4:52 · a question answered". */
export function callSummary(call: Call, nowS: number): string {
  const line = callLine(call, nowS)
  const answered = call.answers.filter(answer => answer.answer).length
  const extra = answered ? ` · ${answered === 1 ? 'a question answered' : `${answered} questions answered`}` : ''

  return `${line.status.slice(0, 1).toUpperCase()}${line.status.slice(1)}${extra}`
}

/** Under the results' headline: "3 calls, 14 minutes in all. Nothing was agreed." */
export function resultsLine(errand: Pick<Errand, 'calls'>): string {
  const made = errand.calls.filter(call => call.started !== null && call.ended !== null)
  const seconds = made.reduce((sum, call) => sum + ((call.ended ?? 0) - (call.started ?? 0)), 0)
  const minutes = Math.max(1, Math.round(seconds / 60))
  const length = made.length ? `, ${plural(minutes, 'minute', 'minutes')} in all` : ''
  const booked = errand.calls.some(call => call.outcome?.status === 'booked')

  return `${plural(errand.calls.length, 'call', 'calls')}${length}. ${booked ? 'A booking was made.' : 'Nothing was agreed.'}`
}

/** Who picked up, as the report says it. */
export function answeredBy(call: Pick<Call, 'answered_by'>): string {
  return call.answered_by === 'human' ? 'a person answered' : call.answered_by === 'machine' ? 'voicemail answered' : ''
}

/**
 * The answers you gave on a call, in order: those the call has used, then one you just sent that still sits on its open
 * question (the call service moves it over when it reads it).
 */
export function yourAnswers(call: Pick<Call, 'answers' | 'question'>): CallAnswer[] {
  const given = call.answers.filter(answer => answer.answer)
  const pending = call.question?.answer ? call.question : null

  if (!pending || given.some(answer => answer.question === pending.text && answer.asked === pending.asked)) {
    return given
  }

  return [...given, { question: pending.text, answer: pending.answer, asked: pending.asked }]
}

/** What happened during a call besides its fields: your answers, what is still open, and what they asked you to do. */
export function duringCall(call: Pick<Call, 'answers' | 'outcome' | 'started'>): { label: string; text: string; quiet?: boolean }[] {
  const rows: { label: string; text: string; quiet?: boolean }[] = call.answers.map(answer => {
    const at = answer.asked !== undefined && call.started !== null ? ` at ${clock(answer.asked - call.started)}` : ''

    return answer.answer ? { label: `They asked · you answered${at}`, text: `“${answer.question}” “${answer.answer}”` } : { label: `They asked${at} · no answer in time`, text: `“${answer.question}”` }
  })
  const open = String(call.outcome?.open_questions ?? '').trim()
  const asked = String(call.outcome?.they_asked ?? '').trim()
  const notes = String(call.outcome?.notes ?? '').trim()

  if (open) {
    rows.push({ label: 'Still open', text: open })
  }

  rows.push(asked ? { label: 'They asked you to', text: asked } : { label: 'They asked you to', text: 'Nothing', quiet: true })

  if (notes) {
    rows.push({ label: 'Notes', text: notes })
  }

  return rows
}

// ── a call's transcript ──────────────────────────────────────────────────────────────────────────

export interface ShownLine {
  /** `quiet`: something the call did (a key pressed, a question to you), not words said. */
  kind: 'assistant' | 'them' | 'quiet'
  who: string
  at: string
  text: string
}

/** The voice's own notes in the transcript ("[pressed 1]", "[asked Alex: …]") said plainly; null for real speech. */
export function quietNote(text: string, name: string): string | null {
  const match = /^\[([\s\S]*)\]$/.exec(text.trim())

  if (!match) {
    return null
  }

  const body = (match[1] ?? '').trim()
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rules: [RegExp, (rest: string) => string][] = [
    [/^pressed\s+(.+)$/i, rest => `Pressed ${rest}`],
    [new RegExp(`^asked ${escaped}:\\s*(.+)$`, 'i'), rest => `Asked you: ${rest}`],
    [new RegExp(`^${escaped} answered:\\s*(.+)$`, 'i'), rest => `You answered: ${rest}`],
    [/^not asked:\s*(.+)$/i, rest => `Didn’t ask you (questions are off or used up): ${rest}`],
    [/answer held back/i, () => 'Your answer was held back: it can’t go on a call'],
  ]

  for (const [pattern, say] of rules) {
    const found = pattern.exec(body)

    if (found) {
      return say(found[1] ?? '')
    }
  }

  return body
}

export function transcriptLines(call: Pick<Call, 'transcript' | 'name'>, name: string): ShownLine[] {
  return call.transcript.map(line => {
    const at = clock(line.t)
    const quiet = line.who === 'assistant' ? quietNote(line.text, name) : null

    if (quiet) {
      return { kind: 'quiet', who: '', at, text: quiet }
    }

    return line.who === 'assistant' ? { kind: 'assistant', who: 'Assistant', at, text: line.text } : { kind: 'them', who: shortName(call.name), at, text: line.text }
  })
}

// ── what waits on you ────────────────────────────────────────────────────────────────────────────

export interface PhoneNeeds {
  /** Errands waiting for your OK, oldest first. */
  requests: Errand[]
  /** Live calls holding a question for you. */
  questions: { errand: Errand; call: Call }[]
  /** Finished errands with something a call asked of you, not marked done, newest first. */
  asked: Errand[]
}

export function phoneNeeds(errands: readonly Errand[], dismissed: readonly string[], nowS: number): PhoneNeeds {
  const requests = errands.filter(errand => errand.status === 'pending').sort((a, b) => a.created - b.created)
  const questions = errands.flatMap(errand => (errand.status === 'running' || errand.status === 'cancelled' ? errand.calls.filter(call => openQuestion(call, nowS)).map(call => ({ errand, call })) : []))
  const asked = errands
    .filter(errand => errand.status === 'done' && !dismissed.includes(errand.id) && theyAsked(errand).length > 0 && nowS - (errand.finished ?? errand.created) < ASKED_DAYS * 86_400)
    .sort((a, b) => (b.finished ?? b.created) - (a.finished ?? a.created))

  return { requests, questions, asked }
}

// ── settings ─────────────────────────────────────────────────────────────────────────────────────

/** "8 AM", "12 PM", and the end of the day as "midnight". */
export function hourLabel(hour: number): string {
  if (hour === 0 || hour === 24) {
    return hour === 24 ? 'midnight' : '12 AM'
  }

  return hour === 12 ? '12 PM' : hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

export function hoursLabel(hours: PhoneSettings['hours']): string {
  return `${hourLabel(hours[0])} – ${hourLabel(hours[1])}`
}

/** The public address without its scheme, for a row's value. */
export function addressLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '') || 'Not set'
}

/** A number as you typed it, made comparable: digits only, US and Canada without the leading 1. */
export function numberKey(number: string): string {
  const digits = number.replace(/\D/g, '')

  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** Adds a number to a list unless it is already there (in any formatting). Null when it is not a number. */
export function addNumber(list: readonly string[], typed: string): string[] | null {
  const key = numberKey(typed)

  if (key.length < 7) {
    return null
  }

  return list.some(number => numberKey(number) === key) ? [...list] : [...list, typed.trim()]
}

// ── where an errand sits in its chat ─────────────────────────────────────────────────────────────

/**
 * The errands to draw in one chat: those the bot made in it (`ids`: the chat's stored ids, every one it is known by). The
 * bot's main chat also takes those made with no chat known.
 */
export function errandsForChat<T extends Pick<Errand, 'profile' | 'session_id'>>(errands: readonly T[], profile: string, ids: readonly (string | null | undefined)[], main: boolean): T[] {
  const known = new Set(ids.filter((id): id is string => !!id))

  return errands.filter(errand => errand.profile === profile && (known.has(errand.session_id) || (main && !errand.session_id)))
}

/** The errand calling now in this chat, if any (the tray holds its call). */
export function callingErrand<T extends Pick<Errand, 'status' | 'calls'>>(errands: readonly T[]): T | undefined {
  return errands.find(errand => (errand.status === 'running' || errand.status === 'cancelled') && !!activeCall(errand))
}

/** An errand drawn in a chat. */
export interface Placed<T> {
  kind: 'errand'
  id: string
  errand: T
}

/**
 * The chat's items (oldest first) with each errand at the end of the turn it was made in: just before the first turn after
 * it (`boundary` gives a turn's start, with its time when known, and null for anything else: a date line counts as a start).
 * A bot writes the request partway through a turn and then says so, so the card comes after its words, as it would in Grok.
 */
export function placeErrands<I, T extends { id: string; created: number }>(items: readonly I[], errands: readonly T[], boundary: (item: I) => { ts?: number } | null): (I | Placed<T>)[] {
  const ordered = [...errands].sort((a, b) => a.created - b.created)
  const placed = (errand: T): Placed<T> => ({ kind: 'errand', id: `errand-${errand.id}`, errand })
  // For each item, the time of the first timed turn start at or after it.
  const upcoming: (number | undefined)[] = new Array(items.length)
  let ts: number | undefined

  for (let index = items.length - 1; index >= 0; index--) {
    ts = boundary(items[index] as I)?.ts ?? ts
    upcoming[index] = ts
  }

  const out: (I | Placed<T>)[] = []
  let next = 0

  items.forEach((item, index) => {
    const at = upcoming[index]

    // Errands made before the next turn start belong to the turn that ends here.
    while (at !== undefined && boundary(item) && next < ordered.length && (ordered[next] as T).created * 1000 < at) {
      out.push(placed(ordered[next++] as T))
    }

    out.push(item)
  })

  return [...out, ...ordered.slice(next).map(placed)]
}
