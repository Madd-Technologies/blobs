/**
 * Group rooms: the typed calls and everything the screens need to read a room's log. Pure: no React Native imports.
 *
 * A room is run by the Hermes server itself (`groups.*`), so bots keep talking with the app closed. You append
 * `message.user` events; the server picks who answers (everyone, or only the `@handle`s you name), up to three
 * rounds, and appends their `message.member` events. Reading is polling `groups.log` after the last `seq` you saw.
 */

import { call, type RpcClient } from './rpc.ts'
import type { ActiveSessionRow, ClarifyQuestion, HostedRoom, RoomEvent, RoomLogPage, RoomMember, RoomDriverStatus, RoomPendingAction } from './protocol.ts'

/** The server's limits for a room's roster. */
export const MIN_MEMBERS = 2
export const MAX_MEMBERS = 6

/** One conversation per room: everything you and the bots say is read as a single thread. */
export const MAIN_THREAD = 't-main'

/** How much of a room's recent log the app keeps in memory. */
export const KEEP_EVENTS = 300

// ── ids and handles ──────────────────────────────────────────────────────────────────────────────

/** `r-k3j2h1f9x0a`: ids must match `^[A-Za-z0-9][A-Za-z0-9._:-]*$`. Not secret, just unlikely to repeat. */
export function newId(prefix: string, now: number = Date.now(), random: () => number = Math.random): string {
  return `${prefix}-${now.toString(36)}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`
}

/** `Forge Scout!` → `forge-scout`; empty when nothing usable is left. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
}

const RESERVED = new Set(['all', 'everyone', 'you', 'user'])

/**
 * What to call a bot in `@mentions`: its display name, or its profile when that gives nothing usable or is taken.
 * The server needs handles unique (ignoring case) and never `all` or `everyone`; `you` and `user` are the bot's way
 * of addressing the person, so they are kept out too.
 */
export function handleFor(displayName: string, profile: string, taken: ReadonlySet<string>): string {
  const candidates = [slug(displayName), slug(profile)].filter(Boolean)

  for (const base of candidates) {
    if (!RESERVED.has(base) && !taken.has(base)) {
      return base
    }
  }

  const base = candidates[0] && !RESERVED.has(candidates[0]) ? candidates[0] : 'bot'

  if (!taken.has(base)) {
    return base
  }

  for (let n = 2; ; n += 1) {
    const next = `${base}-${n}`

    if (!taken.has(next)) {
      return next
    }
  }
}

export interface BotChoice {
  profile: string
  name: string
}

/** The roster for `groups.create`, in the order picked. Member ids are stable per bot; handles are unique. */
export function buildMembers(bots: BotChoice[]): RoomMember[] {
  const taken = new Set<string>()

  return bots.map(bot => {
    const handle = handleFor(bot.name, bot.profile, taken)
    taken.add(handle)

    return { member_id: `m-${bot.profile}`, profile: bot.profile, handle, display_name: bot.name }
  })
}

/** "Hermes, Forge and Scout": a room's default name and its subtitle. */
export function nameList(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// ── the log ──────────────────────────────────────────────────────────────────────────────────────

/** Events by `seq`, oldest first, with duplicates dropped; keeps the newest `KEEP_EVENTS`. */
export function mergeEvents(existing: RoomEvent[], incoming: RoomEvent[], keep: number = KEEP_EVENTS): RoomEvent[] {
  if (!incoming.length) {
    return existing
  }

  const bySeq = new Map<number, RoomEvent>()

  for (const event of existing) {
    bySeq.set(event.seq, event)
  }

  for (const event of incoming) {
    bySeq.set(event.seq, event)
  }

  const merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq)

  return merged.length > keep ? merged.slice(merged.length - keep) : merged
}

const AT_YOU = /(^|[^A-Za-z0-9_])@(you|user)(?![A-Za-z0-9_-])/i

/** A bot is addressing the person (`@you` or `@user`), which is how a room says it needs you. */
export const mentionsYou = (text: string): boolean => AT_YOU.test(text)

export interface TextPart {
  text: string
  /** `you` is the person being addressed; `member` is one of the room's handles. */
  mention?: 'you' | 'member'
}

/** Splits a message into plain text and `@mentions`, so mentions can be drawn apart. Unknown `@words` stay plain. */
export function splitMentions(text: string, handles: string[]): TextPart[] {
  const known = new Set(handles.map(handle => handle.toLowerCase()))
  const parts: TextPart[] = []
  const pattern = /(^|[^A-Za-z0-9_])@([A-Za-z0-9][A-Za-z0-9._:-]*)/g
  let last = 0

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    // A trailing sentence dot or colon is not part of the handle.
    const word = (match[2] as string).replace(/[.:-]+$/, '')
    const lower = word.toLowerCase()
    const kind = lower === 'you' || lower === 'user' ? 'you' : known.has(lower) ? 'member' : null

    if (!kind) {
      continue
    }

    const start = match.index + (match[1] as string).length
    const end = start + 1 + word.length

    if (start > last) {
      parts.push({ text: text.slice(last, start) })
    }

    parts.push({ text: text.slice(start, end), mention: kind })
    last = end
    pattern.lastIndex = end
  }

  if (last < text.length) {
    parts.push({ text: text.slice(last) })
  }

  return parts
}

export type TimelineItem =
  | { kind: 'time'; id: string; ts: number }
  | { kind: 'user'; id: string; seq: number; text: string; ts: number }
  | { kind: 'member'; id: string; seq: number; memberId: string; name: string; profile: string; text: string; ts: number; atYou: boolean }
  | { kind: 'note'; id: string; text: string; detail?: string; tone: 'quiet' | 'danger' }

/** A gap of this long between messages gets a time label. */
const TIME_GAP_S = 30 * 60

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const textOf = (event: RoomEvent): string => (typeof event.payload.text === 'string' ? event.payload.text : '')

export function memberOf(room: Pick<HostedRoom, 'members'>, memberId: string): RoomMember | undefined {
  return room.members.find(member => member.member_id === memberId)
}

/** A member's name as the room shows it: its display name, else the profile. */
export function memberName(room: Pick<HostedRoom, 'members'>, memberId: string, actor?: RoomEvent['actor']): string {
  const member = memberOf(room, memberId)

  return member?.display_name || actor?.display_name || member?.profile || actor?.profile || memberId
}

/**
 * The room as a conversation, oldest first: your messages, the bots' messages (with who said it), a quiet line when
 * you stopped the room, and a red one when a bot's turn failed. Turn bookkeeping and system events are left out.
 */
export function buildTimeline(room: Pick<HostedRoom, 'members'>, events: RoomEvent[]): TimelineItem[] {
  const items: TimelineItem[] = []
  let lastMessageTs = 0

  const stamp = (ts: number, seq: number) => {
    if (!lastMessageTs || ts - lastMessageTs > TIME_GAP_S) {
      items.push({ kind: 'time', id: `time-${seq}`, ts })
    }

    lastMessageTs = ts
  }

  for (const event of events) {
    if (event.kind === 'message.user') {
      const text = textOf(event).trim()

      if (text) {
        stamp(event.created_at, event.seq)
        items.push({ kind: 'user', id: `e-${event.seq}`, seq: event.seq, text, ts: event.created_at })
      }
    } else if (event.kind === 'message.member') {
      const text = textOf(event).trim()
      const memberId = typeof event.payload.member_id === 'string' ? event.payload.member_id : event.actor.id

      if (text) {
        stamp(event.created_at, event.seq)
        items.push({
          kind: 'member',
          id: `e-${event.seq}`,
          seq: event.seq,
          memberId,
          name: memberName(room, memberId, event.actor),
          profile: memberOf(room, memberId)?.profile ?? event.actor.profile ?? memberId,
          text,
          ts: event.created_at,
          atYou: mentionsYou(text),
        })
      }
    } else if (event.kind === 'turn.failed') {
      const memberId = typeof event.payload.member_id === 'string' ? event.payload.member_id : ''
      const error = typeof event.payload.error === 'string' ? oneLine(event.payload.error, 140) : ''

      items.push({ kind: 'note', id: `e-${event.seq}`, text: `${memberName(room, memberId)} couldn’t reply`, detail: error || undefined, tone: 'danger' })
    } else if (event.kind === 'room.stop_requested') {
      items.push({ kind: 'note', id: `e-${event.seq}`, text: 'Stopped', tone: 'quiet' })
    } else if (event.kind === 'turn.cancelled' && event.payload.reason === SUPERSEDED) {
      // The reply was written but thrown away: only the newest message in the thread counts, and it starts the discussion over.
      const memberId = typeof event.payload.member_id === 'string' ? event.payload.member_id : ''

      items.push({ kind: 'note', id: `e-${event.seq}`, text: `${memberName(room, memberId)}’s reply was set aside for your newer message`, tone: 'quiet' })
    }
  }

  return items
}

/** Why the server threw a reply away: you sent a newer message while the bot was still writing it. */
const SUPERSEDED = 'superseded_by_newer_user_event'

/** The room's members a message @mentions (`@all` or `@everyone` is all of them). Member ids, in room order. */
function askedIn(room: Pick<HostedRoom, 'members'>, text: string): string[] {
  if (AT_EVERYONE.test(text)) {
    return room.members.map(member => member.member_id)
  }

  const byHandle = new Map(room.members.map(member => [member.handle.toLowerCase(), member.member_id]))
  const named = new Set(splitMentions(text, [...byHandle.keys()]).flatMap(part => (part.mention === 'member' ? [byHandle.get(part.text.slice(1).toLowerCase())] : [])))

  return room.members.filter(member => named.has(member.member_id)).map(member => member.member_id)
}

export interface PausedAsk {
  /** The bot whose question was left hanging. */
  askerId: string
  /** The bots it asked that never got a turn to answer. Member ids, in room order. */
  asked: string[]
  /** Why the server stopped: after three rounds, or after ten bot messages for one message of yours. */
  reason: 'max_rounds' | 'max_messages'
}

/**
 * A bot conversation the server cut off with a question still open. The server lets bots go on for at most three rounds (and
 * ten messages) per message of yours, and a bot @mentioned in the last round is never asked. Then the room just goes quiet
 * until you write again. Null when the room's latest discussion ended any other way, nobody was left asked, or you have
 * written since.
 */
export function pausedAsk(room: Pick<HostedRoom, 'members'>, events: RoomEvent[]): PausedAsk | null {
  const end = events.findLastIndex(event => event.kind === 'room.activity')
  const activity = events[end]

  if (!activity || activity.payload.status !== 'bounded' || events.slice(end + 1).some(event => event.kind === 'message.user')) {
    return null
  }

  const discussion = activity.payload.discussion_event_id
  // Member id → who asked it. A bot that posts afterwards has answered.
  const asked = new Map<string, string>()

  for (const event of events.slice(0, end)) {
    if (event.kind !== 'message.member' || event.payload.discussion_event_id !== discussion) {
      continue
    }

    const author = typeof event.payload.member_id === 'string' ? event.payload.member_id : event.actor.id
    asked.delete(author)

    for (const id of askedIn(room, textOf(event))) {
      if (id !== author) {
        asked.set(id, author)
      }
    }
  }

  const open = room.members.map(member => member.member_id).filter(id => asked.has(id))
  const last = open.at(-1)

  if (!last) {
    return null
  }

  return { askerId: asked.get(last) as string, asked: open, reason: activity.payload.reason_code === 'max_messages' ? 'max_messages' : 'max_rounds' }
}

/**
 * Members stuck on a question asked through clarify. Hermes runs a member's turn with no app attached (often in another
 * process than the one the app talks to), so nobody can answer it and the turn waits for clarify's timeout, an hour by
 * default. hermes-bot-mobile 0.1.10 turns such a question back so the bot asks in the room instead; until then, stopping
 * the turn and asking again is the way out. Member ids, in the order given.
 */
export function stuckOnQuestion(replying: string[], activity: Record<string, { phase?: string; tool?: string | null } | undefined> | null | undefined): string[] {
  return replying.filter(id => activity?.[id]?.phase === 'tool' && activity[id]?.tool === 'clarify')
}

/** What to send after stopping a member stuck on a question, so it asks in the room. */
export function askHereText(room: Pick<HostedRoom, 'members'>, memberIds: string[]): string {
  const handles = memberIds.map(id => `@${memberOf(room, id)?.handle ?? id}`).join(' ')

  return `${handles} I can’t see questions asked with clarify in this room. Ask me here in your message instead.`
}

/** "Paused after three rounds. Hermes asked Forge." */
export function pausedLine(room: Pick<HostedRoom, 'members'>, paused: PausedAsk): string {
  const limit = paused.reason === 'max_messages' ? 'ten bot messages' : 'three rounds'

  return `Paused after ${limit}. ${memberName(room, paused.askerId)} asked ${nameList(paused.asked.map(id => memberName(room, id)))}.`
}

/** What to send so the bots left asked answer: their handles, and who asked them. */
export function answerPausedText(room: Pick<HostedRoom, 'members'>, paused: PausedAsk): string {
  const handles = paused.asked.map(id => `@${memberOf(room, id)?.handle ?? id}`).join(' ')

  return `${handles}, ${memberName(room, paused.askerId)} asked you above.`
}

export interface RoomAttention {
  /** Approvals and retries the server is holding the room for. */
  actions: RoomPendingAction[]
  /** A bot's latest message addresses you and you have not answered. */
  mention: { memberId: string; name: string; text: string } | null
  needsYou: boolean
}

/**
 * Whether a room is waiting on you: an approval or a retry the driver holds, or a bot's latest message that says
 * `@you` with nothing from you after it (the room's equivalent of "Waiting for you").
 */
export function roomAttention(room: Pick<HostedRoom, 'members'>, events: RoomEvent[], status: RoomDriverStatus | null | undefined): RoomAttention {
  const actions = (status?.pending_actions ?? []).flatMap(action => {
    if (action.kind === 'approval') {
      return [action]
    }

    return action.kind === 'retry' && !settling(status) ? [{ ...action, member_id: action.member_id ?? memberOfTask(events, action.task_id) }] : []
  })
  let mention: RoomAttention['mention'] = null

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as RoomEvent

    if (event.kind === 'message.user') {
      break
    }

    if (event.kind === 'message.member' && mentionsYou(textOf(event))) {
      const memberId = typeof event.payload.member_id === 'string' ? event.payload.member_id : event.actor.id
      mention = { memberId, name: memberName(room, memberId, event.actor), text: textOf(event) }
      break
    }
  }

  return { actions, mention, needsYou: actions.length > 0 || mention !== null }
}

/**
 * A reply cut off mid-way (the server restarted, or lost track of it) is first "indeterminate": the server checks on it by
 * itself for about a minute, and refuses a retry while the original attempt is still running. Only once it gives up does the
 * task become "deferred", which is when a retry is yours to make. The rows do not say which is which, so the counts decide:
 * nothing deferred yet means every retry row is still settling. A server that sends no counts gets the rows as they are.
 */
function settling(status: RoomDriverStatus | null | undefined): boolean {
  const counts = status?.counts ?? {}

  return (counts.indeterminate ?? 0) > 0 && !((counts.deferred ?? 0) > 0)
}

/** Which member a room task belonged to, from the turn events the server logged for it. */
function memberOfTask(events: RoomEvent[], taskId: string): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = (events[index] as RoomEvent).payload

    if (payload.task_id === taskId && typeof payload.member_id === 'string') {
      return payload.member_id
    }
  }

  return undefined
}

// ── who is replying ──────────────────────────────────────────────────────────────────────────────

/** The hidden session the server runs one member's turns of a room in (one per member and room, made on its first turn). */
export const roomSessionTitle = (roomId: string): string => `Group: ${roomId}`

const TURN_ENDS = new Set(['turn.settled', 'turn.failed', 'turn.cancelled', 'turn.deferred'])
const AT_EVERYONE = /(^|[^A-Za-z0-9_])@(all|everyone)(?![A-Za-z0-9_-])/i

/**
 * Who is replying right now, from the server's live sessions (`session.active_list`): a member is replying while its room
 * session is working. `sessions` holds each member's room session ids, found with `session.list`. Member ids, in room order.
 */
export function replyingFromSessions(room: Pick<HostedRoom, 'members'>, sessions: Record<string, string[] | undefined>, live: Pick<ActiveSessionRow, 'id' | 'session_key' | 'status'>[]): string[] {
  const busy = new Set(live.filter(row => row.status === 'working' || row.status === 'starting').flatMap(row => [row.id, row.session_key]))

  return room.members.filter(member => (sessions[member.member_id] ?? []).some(id => busy.has(id))).map(member => member.member_id)
}

/**
 * Members whose room session is waiting on a person (`status: waiting`: a question, a secret or sudo), each with the live
 * session id its parked request is read from. Hermes runs room members on an internal connection with no app attached, so a
 * question a member asks waits in the server's open requests until someone claims it (Hermes 0.21.5,
 * tui_gateway/session_transports.py `_session_client_answers_requests`).
 */
export function waitingFromSessions(room: Pick<HostedRoom, 'members'>, sessions: Record<string, string[] | undefined>, live: Pick<ActiveSessionRow, 'id' | 'session_key' | 'status'>[]): { memberId: string; sessionId: string }[] {
  return room.members.flatMap(member => {
    const ids = new Set(sessions[member.member_id] ?? [])
    const row = live.find(entry => entry.status === 'waiting' && (ids.has(entry.id) || (!!entry.session_key && ids.has(entry.session_key))))

    return row ? [{ memberId: member.member_id, sessionId: row.id }] : []
  })
}

/** A question a room member asked you, claimed from its session's open requests. */
export interface RoomQuestion {
  memberId: string
  /** The member's live session, where the request waits. */
  sessionId: string
  /** The server request's id: the answer goes back under it. */
  requestId: string
  questions: ClarifyQuestion[]
}

/** The questions in a session's open requests (`session.events.since` → `open_requests`); secrets and sudo are left out. */
export function roomQuestionsFrom(memberId: string, sessionId: string, open: unknown): RoomQuestion[] {
  if (!Array.isArray(open)) {
    return []
  }

  return open.flatMap(entry => {
    const frame = entry && typeof entry === 'object' ? (entry as { id?: unknown; method?: unknown; params?: Record<string, unknown> }) : null

    if (!frame || frame.method !== 'clarify' || (typeof frame.id !== 'string' && typeof frame.id !== 'number')) {
      return []
    }

    const params = frame.params ?? {}
    const batch = Array.isArray(params.questions) ? (params.questions as ClarifyQuestion[]) : []
    const single = typeof params.question === 'string' ? [{ question: params.question, choices: Array.isArray(params.choices) ? (params.choices as string[]) : null, ...(params.multi_select ? { multi_select: true } : {}) } as ClarifyQuestion] : []
    const questions = batch.length ? batch : single

    return questions.length ? [{ memberId, sessionId, requestId: String(frame.id), questions }] : []
  })
}

/**
 * Who should be replying, read from the log, for when the live sessions cannot say: the bots your latest message asked (the
 * ones it @mentions, or everyone), and any a bot @mentioned since that had not spoken yet (the server does not ask a bot
 * again once it has), that have not finished a turn after being asked. Only meaningful while the room is working. Member
 * ids, in room order.
 */
export function replyingFromLog(room: Pick<HostedRoom, 'members'>, events: RoomEvent[]): string[] {
  const start = events.findLastIndex(event => event.kind === 'message.user')

  if (start < 0) {
    return []
  }

  const everyone = room.members.map(member => member.member_id)
  const named = (text: string): string[] => askedIn(room, text)
  /** Member id → the index of the event that last asked it. */
  const asked = new Map<string, number>()
  const spoke = new Set<string>()
  const first = named(textOf(events[start] as RoomEvent))

  for (const id of first.length ? first : everyone) {
    asked.set(id, start)
  }

  for (let index = start + 1; index < events.length; index += 1) {
    const event = events[index] as RoomEvent
    const member = typeof event.payload.member_id === 'string' ? event.payload.member_id : undefined

    if (TURN_ENDS.has(event.kind) && member !== undefined) {
      asked.delete(member)
    } else if (event.kind === 'message.member') {
      if (member !== undefined) {
        spoke.add(member)
      }

      for (const id of named(textOf(event))) {
        if (id !== member && !spoke.has(id)) {
          asked.set(id, index)
        }
      }
    }
  }

  return everyone.filter(id => asked.has(id))
}

/**
 * Each member's newest turn in the log: when it started (epoch seconds) and whether it has ended. A member without a turn in the
 * events read so far is absent.
 */
export function memberTurns(events: RoomEvent[]): Map<string, { started: number; ended: boolean }> {
  const turns = new Map<string, { started: number; ended: boolean }>()

  for (const event of events) {
    const member = typeof event.payload.member_id === 'string' ? event.payload.member_id : undefined

    if (member === undefined) {
      continue
    }

    if (event.kind === 'turn.started') {
      turns.set(member, { started: event.created_at, ended: false })
    } else if (TURN_ENDS.has(event.kind)) {
      turns.set(member, { started: turns.get(member)?.started ?? event.created_at, ended: true })
    }
  }

  return turns
}

/**
 * What each replying member is doing, from the plugin, kept only if it was recorded during that member's current turn. Hermes
 * never tells the plugin a turn ended normally, so a member's last phase ("writing") stays in its file until the next turn
 * changes it; shown as-is it read "writing · 8 min" after a reply that took seconds.
 */
export function currentActivity(activity: Record<string, MemberActivity> | null | undefined, replying: string[], events: RoomEvent[]): Record<string, MemberActivity> | null {
  if (!activity) {
    return activity ?? null
  }

  const turns = memberTurns(events)
  const kept = Object.entries(activity).filter(([member, entry]) => {
    const turn = turns.get(member)

    // A few seconds of slack: the plugin's clock and the log's are the same server's, but the turn may log just after it starts.
    return replying.includes(member) && (!turn || entry.since == null || entry.since >= turn.started - 5)
  })

  return Object.fromEntries(kept)
}

/** Who to show as replying: the live sessions when they name anyone, otherwise the log's reading. Nobody unless the room works. */
export function whoIsReplying(
  room: Pick<HostedRoom, 'members'>,
  events: RoomEvent[],
  status: RoomDriverStatus | null | undefined,
  sessions: Record<string, string[] | undefined>,
  live: Pick<ActiveSessionRow, 'id' | 'session_key' | 'status'>[] | null,
): string[] {
  if (!status?.working) {
    return []
  }

  // A member's hidden session can go on reporting "working" for a while after its reply is in; the log's turn end is the truth.
  const turns = memberTurns(events)
  const fromSessions = (live ? replyingFromSessions(room, sessions, live) : []).filter(member => !turns.get(member)?.ended)

  return fromSessions.length ? fromSessions : replyingFromLog(room, events)
}

/**
 * What a bot in a room is doing right now, from the server's hermes-bot-mobile plugin (Hermes's live room-member events): a
 * tool running (and which), thinking, writing its message, or waiting for your OK.
 */
export interface MemberActivity {
  phase: 'tool' | 'thinking' | 'writing' | 'approval' | (string & {})
  tool: string | null
  /** Epoch seconds when this phase began. */
  since: number | null
}

const TOOL_PHRASES: [RegExp, string][] = [
  [/^(terminal|shell|bash|run_command|process)$/, 'running a command'],
  [/^(execute_code|code_execution|python)$/, 'running code'],
  [/^web_search$|search_web|^search$/, 'searching the web'],
  [/^(web_extract|browser|browse|fetch|web_fetch)|^browser_/, 'reading a web page'],
  [/^(read_file|search_files|list_files|file_search|grep|glob)$/, 'reading files'],
  [/^(write_file|patch|edit_file|apply_patch|create_file)$/, 'editing files'],
  [/^(delegate_task|spawn_subagent|subagent)$/, 'handing work to a helper'],
  [/^(vision_analyze|vision|analyze_image)$/, 'looking at a picture'],
  [/^(image_generate|generate_image)$/, 'making a picture'],
  [/^(skill_view|skills_list|skill_manage)$/, 'checking its skills'],
  [/^(memory|memory_search|session_search)$/, 'checking its memory'],
  [/^send_message$/, 'messaging'],
  [/^(cronjob|cron)/, 'setting up a routine'],
  [/^computer_use|^screen_/, 'using its screen'],
]

/** "running a command", "searching the web", "using bank" (an MCP server), or "using <tool>". */
export function toolPhrase(tool: string | null | undefined): string {
  const name = (tool ?? '').trim()

  if (!name) {
    return 'working'
  }

  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name)

  if (mcp) {
    return `using ${mcp[1]}`
  }

  return TOOL_PHRASES.find(([pattern]) => pattern.test(name))?.[1] ?? `using ${name.replace(/_/g, ' ')}`
}

/** What one member is doing, as words after its name: "is running a command", "is writing", "needs your OK". */
export function activityPhrase(activity: MemberActivity | null | undefined): string {
  switch (activity?.phase) {
    case 'tool':
      // A question asked through clarify, which nobody can answer in a room (see stuckOnQuestion).
      return activity.tool === 'clarify' ? 'has a question' : `is ${toolPhrase(activity.tool)}`
    case 'thinking':
      return 'is thinking'
    case 'writing':
      return 'is writing'
    case 'approval':
      return 'needs your OK'
    default:
      return 'is working'
  }
}

/**
 * "Orion is running a command…", "Orion is writing…", "Orion and Juniper are working…", "Working…" when nobody can be named.
 * Without the server's activity it says "working": a turn that has not ended may be running tools for minutes, not
 * writing a reply.
 */
export function replyingLine(room: Pick<HostedRoom, 'members'>, replying: string[], activity?: Record<string, MemberActivity> | null): string {
  const names = replying.map(id => memberName(room, id))

  if (names.length === 0) {
    return 'Working…'
  }

  if (names.length === 1) {
    const phrase = activityPhrase(activity?.[replying[0] as string])

    return phrase === 'needs your OK' ? `${names[0]} needs your OK` : `${names[0]} ${phrase}…`
  }

  const writing = replying.every(id => activity?.[id]?.phase === 'writing')

  return `${nameList(names)} are ${writing ? 'writing' : 'working'}…`
}

/** The line under a room's name on Home: the last message with who said it, or what the room is doing. */
export function roomPreview(room: Pick<HostedRoom, 'members'>, events: RoomEvent[], working: boolean, replying: string[] = [], activity?: Record<string, MemberActivity> | null): string {
  const last = [...buildTimeline(room, events)].reverse().find(item => item.kind === 'user' || item.kind === 'member')

  if (working) {
    return replyingLine(room, replying, activity)
  }

  if (!last || (last.kind !== 'user' && last.kind !== 'member')) {
    return 'No messages yet'
  }

  return `${last.kind === 'user' ? 'You' : last.name}: ${oneLine(last.text, 100)}`
}

/** Epoch seconds of the room's newest event, falling back to when the room last changed. */
export function roomLastActive(room: Pick<HostedRoom, 'updated_at'>, events: RoomEvent[]): number {
  return Math.max(room.updated_at, events[events.length - 1]?.created_at ?? 0)
}

// ── calls ────────────────────────────────────────────────────────────────────────────────────────

/** Whether this server can run rooms: its worker is up. A server without `groups.*` answers method-not-found. */
export async function roomsAvailable(client: RpcClient): Promise<boolean> {
  try {
    return (await call(client, 'groups.capabilities', {})).driver === true
  } catch {
    return false
  }
}

export async function listRooms(client: RpcClient): Promise<HostedRoom[]> {
  const rooms: HostedRoom[] = []

  for (let offset = 0; ; ) {
    const page = await call(client, 'groups.list', { offset })
    rooms.push(...page.rooms)

    if (page.next_offset === null || page.next_offset <= offset || rooms.length > 500) {
      return rooms
    }

    offset = page.next_offset
  }
}

export const createRoom = (client: RpcClient, name: string, members: RoomMember[], id: string = newId('r')) => call(client, 'groups.create', { room_id: id, name, members }).then(result => result.room)

export const roomState = (client: RpcClient, roomId: string) => call(client, 'groups.state', { room_id: roomId })

/** Reads everything after `since` (up to a few pages), newest page last. */
export async function readLog(client: RpcClient, roomId: string, since: number, pages = 4): Promise<RoomLogPage> {
  let cursor = since
  const events: RoomEvent[] = []
  let page: RoomLogPage = { events, cursor, latest_seq: since, has_more: false }

  for (let index = 0; index < pages; index += 1) {
    page = await call(client, 'groups.log', { room_id: roomId, since_seq: cursor, limit: 100 })
    events.push(...page.events)
    cursor = page.cursor

    if (!page.has_more) {
      break
    }
  }

  return { events, cursor, latest_seq: page.latest_seq, has_more: page.has_more }
}

export const sendRoomMessage = (client: RpcClient, roomId: string, text: string, id: string = newId('e')) =>
  call(client, 'groups.send', { room_id: roomId, event_id: id, payload: { text, thread_id: MAIN_THREAD } }).then(result => result.event)

/**
 * Stops the room's replies. Each stop carries its own cancel id: the server names the stop's log event after it, so a
 * repeated id (its default is one fixed id) only moves the room's stop fence the first time.
 */
export const stopRoom = (client: RpcClient, roomId: string, cancelId: string = newId('stop')) => call(client, 'groups.stop', { room_id: roomId, cancel_id: cancelId }).then(result => result.cancelled)

export const approveRoomAction = (client: RpcClient, roomId: string, action: RoomPendingAction, choice: 'once' | 'deny') =>
  call(client, 'groups.approve', {
    room_id: roomId,
    member_id: action.member_id ?? '',
    task_id: action.task_id,
    execution_generation: action.execution_generation ?? 0,
    choice,
    request_id: action.request_id ?? '',
  })

export const retryRoomTask = (client: RpcClient, roomId: string, taskId: string) => call(client, 'groups.retry', { room_id: roomId, task_id: taskId })

export const renameRoom = (client: RpcClient, roomId: string, name: string, id: string = newId('e')) => call(client, 'groups.rename', { room_id: roomId, event_id: id, name }).then(result => result.room)

export const disbandRoom = (client: RpcClient, roomId: string) => call(client, 'groups.disband', { room_id: roomId })
