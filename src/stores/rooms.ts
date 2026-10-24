import { useMemo } from 'react'
import { create } from 'zustand'

import { buildRoomViews, roomNeedsRead, type RoomData, type RoomView } from '@/features/rooms/view'
import { describeError, type ClarifyAnswer, type RespondResult } from '@/features/sessions/store'
import type { ActiveSessionRow, HostedRoom, RoomLogPage, RoomMember, RoomPendingAction } from '@/lib/hermes/protocol'
import {
  approveRoomAction,
  createRoom,
  currentActivity,
  disbandRoom,
  listRooms,
  mergeEvents,
  readLog,
  renameRoom,
  retryRoomTask,
  roomQuestionsFrom,
  roomSessionTitle,
  roomsAvailable,
  roomState,
  sendRoomMessage,
  stopRoom,
  waitingFromSessions,
  whoIsReplying,
  type RoomQuestion,
} from '@/lib/hermes/rooms'
import { parseRoomLive, parseRoomsChanged, ROOM_LIVE, ROOMS_CHANGED, type RoomLive } from '@/lib/hermes/livepush'
import { getRoomActivity } from '@/lib/hermes/plugins'
import { call } from '@/lib/hermes/rpc'
import { startPoller } from '@/lib/poller'
import { useNow } from '@/lib/useNow'
import { gateway, onGatewayEvent, requests, useConnection } from '@/stores/connection'
import { pushes } from '@/stores/watch'

interface RoomsState {
  /** Whether the server can run rooms (its worker is up). Null until asked. */
  available: boolean | null
  rooms: Record<string, RoomData | undefined>
  /** At least one list has arrived. */
  loaded: boolean
  error: string | null
  refresh: () => Promise<void>
  /** Reads one room again; `moved` when the server already said it moved (no need to look for anything new first). */
  refreshRoom: (id: string, moved?: boolean) => Promise<void>
  /** Each watched room's members' turns as they stream (hermes-bot-mobile 0.2+), for the room screen. */
  live: Record<string, RoomLive | undefined>
}

/** On the first look at a room, start this far back from its newest event instead of replaying everything. */
const FIRST_LOOK = 60

/** Each room's member sessions (member id → ids), found once per member; one not made yet is looked for again later. */
const roomSessions = new Map<string, Record<string, string[] | undefined>>()
const lookedFor = new Map<string, number>()
const LOOK_AGAIN_MS = 15_000

/**
 * The hidden session each member answers this room in (`Group: <room id>`, made on its first turn there). A member on another
 * server, or one that has not answered yet, has none here: the log says who is replying then.
 */
async function memberSessions(room: HostedRoom): Promise<Record<string, string[] | undefined>> {
  const title = roomSessionTitle(room.room_id)
  const known = { ...roomSessions.get(room.room_id) }
  const now = Date.now()

  await Promise.all(
    room.members.map(async member => {
      const key = `${room.room_id}/${member.member_id}`

      if (known[member.member_id]?.length || now - (lookedFor.get(key) ?? 0) < LOOK_AGAIN_MS) {
        return
      }

      lookedFor.set(key, now)

      try {
        const { sessions } = await call(gateway, 'session.list', { profile: member.profile, title, include_hidden: true })
        const ids = sessions.filter(session => !session.title || session.title === title).flatMap(session => (session.resolved_id ? [session.id, session.resolved_id] : [session.id]))

        if (ids.length) {
          known[member.member_id] = ids
        }
      } catch {
        // Not a profile on this server; the log is enough.
      }
    }),
  )

  roomSessions.set(room.room_id, known)

  return known
}

/** The server's live sessions, read once for every room that asks within a moment of each other. Null when it could not say. */
let live: { at: number; rows: Promise<ActiveSessionRow[] | null> } | null = null

function liveSessions(): Promise<ActiveSessionRow[] | null> {
  if (!live || Date.now() - live.at > 1_500) {
    live = { at: Date.now(), rows: call(gateway, 'session.active_list', {}).then(result => result.sessions, () => null) }
  }

  return live.rows
}

/** Requests already handed to the request bridge (so answering works), and ones answered here (gone before the next read). */
const claimed = new Set<string>()
const answered = new Set<string>()

/**
 * Questions members asked you. Hermes runs room members on an internal connection with no app attached, so a member's question
 * waits in the server's open requests until it times out, blocking the turn (only approvals reach the room's own actions). Each
 * waiting member's session is read with `session.events.since`, which hands back its open requests, and each one is given to the
 * request bridge once, so the usual answer path (a response under the request's id) settles it.
 */
async function claimQuestions(room: HostedRoom, sessions: Record<string, string[] | undefined>, live: ActiveSessionRow[]): Promise<RoomQuestion[]> {
  const found = await Promise.all(
    waitingFromSessions(room, sessions, live).map(async ({ memberId, sessionId }) => {
      try {
        const { open_requests: open = [] } = await call(gateway, 'session.events.since', { session_id: sessionId, last_seen: Number.MAX_SAFE_INTEGER })
        const questions = roomQuestionsFrom(memberId, sessionId, open).filter(question => !answered.has(question.requestId))
        const fresh = (open as { id?: unknown }[]).filter(frame => questions.some(question => question.requestId === String(frame.id)) && !claimed.has(String(frame.id)))

        if (fresh.length) {
          requests.ingest(sessionId, fresh)
          fresh.forEach(frame => claimed.add(String(frame.id)))
        }

        return questions
      } catch {
        // An older server, or the session ended between the two reads: nothing to show.
        return []
      }
    }),
  )

  return found.flat()
}

/**
 * Reads one room's newest events and the server's view of its worker. Asks the server for the room's current state
 * first: a copy fetched earlier would not say whether anything new has been logged since. While the room works, also which
 * bots are replying.
 */
async function syncRoom(room: HostedRoom, previous: RoomData | undefined, read?: RoomLogPage): Promise<RoomData> {
  const state = await roomState(gateway, room.room_id)
  const latest = state.room.latest_seq ?? 0
  const since = previous && previous.cursor > 0 ? previous.cursor : Math.max(0, latest - FIRST_LOOK)
  // A log page read just before (the open room's check for anything new) is used rather than read again.
  const page = read?.events.length ? read : !previous || latest > previous.cursor ? await readLog(gateway, room.room_id, since) : null
  const events = page ? mergeEvents(previous?.events ?? [], page.events) : (previous?.events ?? [])
  const status = state.driver_status ?? null
  // Members' sessions and the server's live ones, while a member is mid-turn: who is replying, and who is waiting on you.
  const busy = status?.working || status?.blocked
  const members = busy ? await memberSessions(state.room) : null
  const liveRows = members ? await liveSessions() : null
  const replying = status?.working && members ? whoIsReplying(state.room, events, status, members, liveRows) : []
  const questions = members && liveRows ? await claimQuestions(state.room, members, liveRows) : []
  const sameReplying = (previous?.replying ?? []).join() === replying.join()
  // What each busy bot is doing (hermes-bot-mobile's room activity), asked only while the room works.
  const config = useConnection.getState().config
  const activity = status?.working && config ? currentActivity(await getRoomActivity(config, state.room.room_id).catch(() => previous?.activity ?? null), replying, events) : null
  const found = Object.values(roomSessions.get(state.room.room_id) ?? {}).flatMap(ids => ids ?? [])
  const sessions = previous?.sessions && previous.sessions.join() === found.join() ? previous.sessions : found
  const unchanged =
    previous &&
    events === previous.events &&
    sameReplying &&
    sessions === previous.sessions &&
    JSON.stringify(status) === JSON.stringify(previous.status) &&
    JSON.stringify(state.room) === JSON.stringify(previous.room) &&
    JSON.stringify(activity) === JSON.stringify(previous.activity ?? null) &&
    JSON.stringify(questions) === JSON.stringify(previous.questions ?? [])

  return unchanged
    ? previous
    : { room: state.room, events, cursor: page ? Math.max(page.cursor, previous?.cursor ?? 0) : (previous?.cursor ?? 0), status, replying: sameReplying && previous?.replying ? previous.replying : replying, sessions, activity, questions }
}

/** Rooms disbanded here: a list read that was already under way must not put one back. */
const disbanded = new Set<string>()

/**
 * A copy of a room read from an older point in its log than the one held. The list (every 5 s) and the open room (every 2 s)
 * read the same rooms, and the slower of two overlapping reads must not put back what the other had moved past.
 */
function staler(data: RoomData, held: RoomData | undefined): boolean {
  return !!held && data.room.room_id === held.room.room_id && data.cursor < held.cursor
}

/** How long a server without a rooms worker is left before asking again whether it has one. */
const AVAILABILITY_RECHECK_MS = 5 * 60_000

export const useRooms = create<RoomsState>((set, get) => {
  let busy = false
  let availabilityCheckedAt = 0

  const put = (id: string, data: RoomData) => {
    const current = get().rooms[id]

    if (current !== data && !staler(data, current)) {
      set(state => ({ rooms: { ...state.rooms, [id]: data } }))
    }
  }

  /** Rooms being read by the room screen's poll, so a slow read is not overlapped by the next one. */
  const reading = new Set<string>()

  return {
    available: null,
    rooms: {},
    loaded: false,
    error: null,
    live: {},

    refresh: async () => {
      if (busy || useConnection.getState().status !== 'online') {
        return
      }

      busy = true

      try {
        if (get().available === null || (get().available === false && Date.now() - availabilityCheckedAt >= AVAILABILITY_RECHECK_MS)) {
          availabilityCheckedAt = Date.now()
          set({ available: await roomsAvailable(gateway) })
        }

        if (!get().available) {
          set({ loaded: true })

          return
        }

        const listed = await listRooms(gateway)
        const known = get().rooms
        const results = await Promise.all(
          listed.map(async room => {
            // Read in full only a room that moved (or is replying): the list alone says enough about the others.
            if (!roomNeedsRead(room, known[room.room_id])) {
              return [room.room_id, known[room.room_id]] as const
            }

            try {
              return [room.room_id, await syncRoom(room, known[room.room_id])] as const
            } catch {
              return [room.room_id, known[room.room_id]] as const
            }
          }),
        )
        // The room screen may have read a room further while this ran: keep its copy then.
        const now = get().rooms
        const next: Record<string, RoomData | undefined> = {}
        let changed = results.length !== Object.keys(now).length

        for (const [id, data] of results) {
          if (disbanded.has(id)) {
            continue
          }

          next[id] = data && staler(data, now[id]) ? now[id] : data
          changed = changed || now[id] !== next[id]
        }

        set(changed ? { rooms: next, loaded: true, error: null } : { loaded: true, error: null })
      } catch (error) {
        set({ error: describeError(error), loaded: true })
      } finally {
        busy = false
      }
    },

    refreshRoom: async (id, moved = false) => {
      const current = get().rooms[id]

      if (!current || reading.has(id) || useConnection.getState().status !== 'online') {
        return
      }

      reading.add(id)

      try {
        if (moved) {
          put(id, await syncRoom(current.room, current))

          return
        }

        // Anything new in its log first: an idle room with nothing new needs no state read (the slow part).
        const read = await readLog(gateway, id, current.cursor, 1)

        if (!read.events.length && !current.status?.working && !current.status?.blocked && (read.latest_seq ?? 0) <= current.cursor) {
          return
        }

        put(id, await syncRoom(current.room, current, read))
      } catch {
        // The next poll tries again; the screen keeps what it has.
      } finally {
        reading.delete(id)
      }
    },
  }
})

/**
 * Keeps the rooms current, so Home shows who said what and which room needs you: the server pushes which rooms moved
 * (hermes-bot-mobile 0.2+) and only those are read, with a safety read of the list every minute; without the push the list is
 * read every 10 s. A room is read in full only when it moved (roomNeedsRead). The rooms on screen also get their members'
 * turns as they stream.
 */
export function startRoomsSync(): () => void {
  const stopPoll = startPoller(() => void useRooms.getState().refresh(), () => (pushes('roomsChanged') ? 60_000 : 10_000), () => useConnection.getState().status === 'online')
  const stopEvents = onGatewayEvent(event => {
    const type = event.type as string

    if (type === ROOM_LIVE) {
      const live = parseRoomLive(event.payload)

      if (live) {
        useRooms.setState(state => ({ live: { ...state.live, [live.room_id]: live } }))
      }

      return
    }

    if (type !== ROOMS_CHANGED) {
      return
    }

    const marks = parseRoomsChanged(event.payload)

    if (!marks) {
      return
    }

    const store = useRooms.getState()
    const known = store.rooms

    // A new room (or one gone) needs the list for its name and members; the others are read only if they moved.
    if (Object.keys(marks).some(id => !known[id] && !disbanded.has(id)) || Object.keys(known).some(id => !(id in marks))) {
      void store.refresh()

      return
    }

    for (const [id, mark] of Object.entries(marks)) {
      if (roomNeedsRead(mark, known[id])) {
        void store.refreshRoom(id, true)
      }
    }
  })
  const stopConnection = useConnection.subscribe((state, previous) => {
    if (state.status === 'online' && previous.status !== 'online') {
      void useRooms.getState().refresh()
    }
  })

  return () => {
    stopPoll()
    stopEvents()
    stopConnection()
  }
}

/**
 * One room while its screen is open (and the app is in front): every 2 s, or a safety check every 15 s when the server pushes
 * the room's changes and its members' turns as they stream.
 */
export function startRoomPoll(id: string): () => void {
  return startPoller(() => void useRooms.getState().refreshRoom(id), () => (pushes('roomsChanged') && pushes('roomLive') ? 15_000 : 2_000), () => useConnection.getState().status === 'online')
}

/** Every room as a row, newest first. */
export function useRoomViews(): RoomView[] {
  const rooms = useRooms(state => state.rooms)
  const now = useNow()

  return useMemo(() => buildRoomViews(rooms, now), [rooms, now])
}

export function useRoomData(id: string): RoomData | undefined {
  return useRooms(state => state.rooms[id])
}

// ── changes: each returns an error to show, or null when it worked ───────────────────────────────

type Outcome = Promise<string | null>

/** Makes a room of these bots and starts watching it. */
export async function makeRoom(name: string, members: RoomMember[]): Promise<{ id: string } | { error: string }> {
  try {
    const room = await createRoom(gateway, name, members)
    useRooms.setState(state => ({ rooms: { ...state.rooms, [room.room_id]: { room, events: [], cursor: 0, status: null } } }))
    void useRooms.getState().refreshRoom(room.room_id)

    return { id: room.room_id }
  } catch (error) {
    return { error: describeError(error) }
  }
}

export async function sendToRoom(id: string, text: string): Outcome {
  try {
    const event = await sendRoomMessage(gateway, id, text)
    const current = useRooms.getState().rooms[id]

    if (current) {
      useRooms.setState(state => ({ rooms: { ...state.rooms, [id]: { ...current, events: mergeEvents(current.events, [event]), cursor: Math.max(current.cursor, event.seq) } } }))
    }

    void useRooms.getState().refreshRoom(id)

    return null
  } catch (error) {
    return describeError(error)
  }
}

export async function stopRoomWork(id: string): Outcome {
  try {
    await stopRoom(gateway, id)
    void useRooms.getState().refreshRoom(id)

    return null
  } catch (error) {
    return describeError(error)
  }
}

export async function answerRoomApproval(id: string, action: RoomPendingAction, choice: 'once' | 'deny'): Promise<RespondResult> {
  try {
    await approveRoomAction(gateway, id, action, choice)
    void useRooms.getState().refreshRoom(id)

    return 'answered'
  } catch (error) {
    void useRooms.getState().refreshRoom(id)

    // Someone else answered it, or the turn ended, before this arrived.
    return /no longer pending/i.test(describeError(error)) ? 'expired' : 'failed'
  }
}

/** Answers a question a room member asked: as a response to its server request, or with `clarify.respond` if the bridge lost it. */
export async function answerRoomQuestion(id: string, question: RoomQuestion, answers: ClarifyAnswer[]): Promise<RespondResult> {
  if (!answers.length) {
    return 'failed'
  }

  const sent = requests.answer(question.requestId, { kind: 'clarify', answers })
  let result: RespondResult = 'answered'

  if (sent === 'failed') {
    return 'failed'
  }

  if (sent === 'unknown') {
    try {
      for (const { questionId, answer } of answers) {
        const reply = await call(gateway, 'clarify.respond', { session_id: question.sessionId, request_id: question.requestId, answer, ...(questionId ? { question_id: questionId } : {}) })

        if (reply.status === 'expired') {
          result = 'expired'
          break
        }
      }
    } catch {
      return 'failed'
    }
  }

  answered.add(question.requestId)
  void useRooms.getState().refreshRoom(id)

  return result
}

/** `who` names the bot whose reply this runs again, for the message if the server refuses. */
export async function retryRoomWork(id: string, taskId: string, who = 'The bot'): Outcome {
  try {
    await retryRoomTask(gateway, id, taskId)
    void useRooms.getState().refreshRoom(id)

    return null
  } catch (error) {
    void useRooms.getState().refreshRoom(id)
    const message = describeError(error)

    // The first attempt is still running on the server: it may yet finish by itself.
    if (/still active/i.test(message)) {
      return `${who} is still finishing that reply. Try again in a minute.`
    }

    // Someone else retried it, or it settled, before this arrived: nothing is left to do.
    return /no retryable room task/i.test(message) ? null : message
  }
}

export async function renameRoomTo(id: string, name: string): Outcome {
  try {
    const room = await renameRoom(gateway, id, name)
    const current = useRooms.getState().rooms[id]

    if (current) {
      useRooms.setState(state => ({ rooms: { ...state.rooms, [id]: { ...current, room } } }))
    }

    return null
  } catch (error) {
    return describeError(error)
  }
}

export async function removeRoom(id: string): Outcome {
  try {
    await disbandRoom(gateway, id)
    disbanded.add(id)
    useRooms.setState(state => {
      const { [id]: _gone, ...rest } = state.rooms

      return { rooms: rest }
    })

    return null
  } catch (error) {
    return describeError(error)
  }
}
