/**
 * Live base-station activity ("In flight"): live phone errands, bots mid-turn, active rooms, and bots with detached
 * background helpers running. Pure: combines data the stores already hold.
 */

import type { BotMeta } from '../../lib/hermes/identity.ts'
import type { Errand } from '../../lib/hermes/phone.ts'
import type { DelegationStatusRow, RoomMember } from '../../lib/hermes/protocol.ts'
import type { RoomView } from '../rooms/view.ts'
import type { BotSession } from '../sessions/store.ts'
import { backgroundGoal, type BotView } from './view.ts'

export type InFlightItem =
  | { kind: 'errand'; key: string; errandId: string; profile: string; title: string; subtitle: string; meta: BotMeta | undefined }
  | { kind: 'bot'; key: string; profile: string; title: string; subtitle: string; meta: BotMeta | undefined; mode: 'working' | 'background' }
  | { kind: 'room'; key: string; roomId: string; title: string; subtitle: string; members: RoomMember[] }

export interface DeriveInFlightInput {
  views: readonly BotView[]
  rooms: readonly RoomView[]
  errands: Record<string, Errand | undefined> | readonly Errand[]
  sessions: Record<string, BotSession | undefined>
  background: readonly DelegationStatusRow[]
}

function errandSubtitle(errand: Errand): string {
  const live = errand.calls.find(call => call.status === 'live')

  if (live) {
    return `Live · ${live.name}`
  }

  const dialing = errand.calls.find(call => call.status === 'dialing' || call.status === 'ringing')

  if (dialing) {
    return `Calling ${dialing.name}…`
  }

  const finished = errand.calls.filter(call => call.status === 'done' || call.status === 'failed' || call.status === 'skipped').length

  return errand.calls.length ? `${finished} of ${errand.calls.length} calls` : 'Running call errand'
}

export function deriveInFlight({ views, rooms, errands, sessions, background }: DeriveInFlightInput): InFlightItem[] {
  const items: InFlightItem[] = []
  const byProfile = new Map(views.map(view => [view.profile, view]))
  const errandList = (Array.isArray(errands) ? errands : Object.values(errands))
    .filter((errand): errand is Errand => !!errand && errand.status === 'running')
    .sort((a, b) => b.created - a.created)

  for (const errand of errandList) {
    const view = byProfile.get(errand.profile)
    items.push({
      kind: 'errand',
      key: `errand:${errand.id}`,
      errandId: errand.id,
      profile: errand.profile,
      title: errand.brief.title || view?.name || errand.profile,
      subtitle: errandSubtitle(errand),
      meta: view?.meta,
    })
  }

  const includedBots = new Set<string>()

  for (const view of views) {
    if (view.attention.state === 'working') {
      includedBots.add(view.profile)
      items.push({
        kind: 'bot',
        key: `bot:${view.profile}`,
        profile: view.profile,
        title: view.name,
        subtitle: view.preview || 'Working…',
        meta: view.meta,
        mode: 'working',
      })
    }
  }

  for (const room of rooms) {
    if (room.working) {
      items.push({
        kind: 'room',
        key: `room:${room.id}`,
        roomId: room.id,
        title: room.name,
        subtitle: room.preview || 'Replying…',
        members: room.data.room.members,
      })
    }
  }

  for (const view of views) {
    if (includedBots.has(view.profile)) {
      continue
    }

    const goal = backgroundGoal(view.row, sessions[view.profile], background)

    if (goal) {
      items.push({
        kind: 'bot',
        key: `bg:${view.profile}`,
        profile: view.profile,
        title: view.name,
        subtitle: `Helper · ${goal}`,
        meta: view.meta,
        mode: 'background',
      })
    }
  }

  return items
}
