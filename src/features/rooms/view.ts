/**
 * One row per room for Home and the inbox, and where rooms slot in among the bots. Pure: combines what the rooms
 * store holds with the clock.
 */

import { ageLabel } from '../roster/derive.ts'
import type { HostedRoom, RoomDriverStatus, RoomEvent } from '../../lib/hermes/protocol.ts'
import { roomAttention, roomLastActive, roomPreview, type MemberActivity, type RoomAttention, type RoomQuestion } from '../../lib/hermes/rooms.ts'

/** What the store keeps per room. */
export interface RoomData {
  room: HostedRoom
  /** The newest part of the room's log, oldest first. */
  events: RoomEvent[]
  /** `seq` of the last event read; 0 before the first read. */
  cursor: number
  /** The server's view of the room's worker: replying, waiting on you. Null until read. */
  status: RoomDriverStatus | null
  /** The members replying right now (ids, in room order), while the room works. */
  replying?: string[]
  /** The members' room sessions found so far (their ids), so the push plugin can be told this room is on screen. */
  sessions?: string[]
  /** What each busy member is doing, from the server's hermes-bot-mobile plugin; null without it or while idle. */
  activity?: Record<string, MemberActivity> | null
  /** Questions members asked you, claimed from their sessions: Hermes sends a room member's question to no one. */
  questions?: RoomQuestion[]
}

export interface RoomView {
  id: string
  name: string
  data: RoomData
  preview: string
  /** "now", "3m", "2h". */
  age: string
  /** Epoch seconds. */
  lastActive: number
  working: boolean
  attention: RoomAttention
  needsYou: boolean
}

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function buildRoomViews(rooms: Record<string, RoomData | undefined>, nowS: number): RoomView[] {
  return Object.values(rooms)
    .filter((data): data is RoomData => !!data)
    .map(data => {
      const working = data.status?.working === true
      const attention = roomAttention(data.room, data.events, data.status)
      const lastActive = roomLastActive(data.room, data.events)

      return {
        id: data.room.room_id,
        name: data.room.name,
        data,
        preview: attention.actions.length || data.questions?.length ? 'Waiting for your answer' : attention.mention ? `${attention.mention.name}: ${oneLine(attention.mention.text, 100)}` : roomPreview(data.room, data.events, working, data.replying, data.activity),
        age: working ? 'now' : ageLabel(lastActive, nowS),
        lastActive,
        working,
        attention,
        needsYou: attention.needsYou || !!data.questions?.length,
      }
    })
    .sort((a, b) => b.lastActive - a.lastActive || a.name.localeCompare(b.name))
}

/** Whether a room matches what was typed in Home's search: its name or any member's name or handle. */
export function roomMatches(view: Pick<RoomView, 'name' | 'data'>, query: string): boolean {
  const needle = query.trim().toLowerCase()

  if (!needle) {
    return true
  }

  return [view.name, ...view.data.room.members.flatMap(member => [member.display_name ?? '', member.handle, member.profile])].some(text => text.toLowerCase().includes(needle))
}
