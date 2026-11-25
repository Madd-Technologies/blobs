/**
 * Pure command registry and filter for Base Station's command palette. No React Native imports.
 */

import type { RoomView } from '../rooms/view.ts'
import type { BotView } from '../roster/view.ts'

export type StationCommand =
  | {
      id: string
      title: string
      subtitle: string
      keywords: string
      icon: 'inbox' | 'sun' | 'shield' | 'bar-chart-2' | 'bell' | 'settings' | 'plus' | 'users' | 'layout' | 'message-square' | 'pause-circle' | 'play-circle' | 'moon'
      kind: 'route'
      pathname: '/inbox' | '/briefing' | '/fleet' | '/telemetry' | '/notifications' | '/settings' | '/bot/new' | '/room/new'
    }
  | {
      id: string
      title: string
      subtitle: string
      keywords: string
      kind: 'bot'
      profile: string
      mode: 'chat' | 'dashboard'
    }
  | {
      id: string
      title: string
      subtitle: string
      keywords: string
      kind: 'room'
      roomId: string
    }
  | {
      id: string
      title: string
      subtitle: string
      keywords: string
      icon: 'pause-circle' | 'play-circle' | 'moon'
      kind: 'action'
      action: 'toggleFleetPause' | 'silence1h'
    }

export function buildStationCommands({
  views,
  rooms,
  fleetPaused,
  quietActive,
  dashboardsReady,
}: {
  views: readonly BotView[]
  rooms: readonly RoomView[]
  fleetPaused: boolean
  quietActive: boolean
  dashboardsReady: boolean
}): StationCommand[] {
  const staticRoutes: StationCommand[] = [
    { id: 'route:inbox', title: 'Needs you', subtitle: 'Open triage deck & list', keywords: 'inbox triage deck queue', icon: 'inbox', kind: 'route', pathname: '/inbox' },
    { id: 'route:briefing', title: 'Morning briefing', subtitle: 'While you were away', keywords: 'briefing summary overnight catchup', icon: 'sun', kind: 'route', pathname: '/briefing' },
    { id: 'route:fleet', title: 'Fleet control', subtitle: 'Bots, routines, emergency pause', keywords: 'fleet pause resume stop bots', icon: 'shield', kind: 'route', pathname: '/fleet' },
    { id: 'route:telemetry', title: 'Usage & cost', subtitle: 'Tokens, sessions, daily spend', keywords: 'telemetry tokens cost usage chart stats', icon: 'bar-chart-2', kind: 'route', pathname: '/telemetry' },
    { id: 'route:notifications', title: 'Notifications & quiet hours', subtitle: 'Alert rules and DND schedule', keywords: 'notifications push quiet hours dnd', icon: 'bell', kind: 'route', pathname: '/notifications' },
    { id: 'route:settings', title: 'Settings', subtitle: 'Servers, theme, preferences', keywords: 'settings server account theme', icon: 'settings', kind: 'route', pathname: '/settings' },
    { id: 'route:bot-new', title: 'New bot', subtitle: 'Create a new Hermes profile', keywords: 'create new bot agent', icon: 'plus', kind: 'route', pathname: '/bot/new' },
    { id: 'route:room-new', title: 'New room', subtitle: 'Start a group room', keywords: 'create new room group', icon: 'users', kind: 'route', pathname: '/room/new' },
  ]

  const quickActions: StationCommand[] = [
    {
      id: 'action:fleet-toggle',
      title: fleetPaused ? 'Resume fleet' : 'Pause fleet',
      subtitle: fleetPaused ? 'Restore scheduled runs & background work' : 'Pause background runs across your fleet',
      keywords: fleetPaused ? 'resume start fleet unpause' : 'pause stop emergency freeze fleet',
      icon: fleetPaused ? 'play-circle' : 'pause-circle',
      kind: 'action',
      action: 'toggleFleetPause',
    },
    {
      id: 'action:quiet-1h',
      title: quietActive ? 'Clear 1h silence' : 'Silence notifications for 1 hour',
      subtitle: quietActive ? 'Re-enable regular alerts now' : 'Snooze non-urgent pushes for 60 minutes',
      keywords: 'quiet mute silence dnd 1h snooze',
      icon: 'moon',
      kind: 'action',
      action: 'silence1h',
    },
  ]

  const botCommands: StationCommand[] = views.flatMap(view => {
    const base: StationCommand = {
      id: `bot:${view.profile}:chat`,
      title: view.name,
      subtitle: view.preview || 'Open chat',
      keywords: `${view.name} ${view.profile} chat`,
      kind: 'bot',
      profile: view.profile,
      mode: 'chat',
    }

    if (!dashboardsReady) {
      return [base]
    }

    const dash: StationCommand = {
      id: `bot:${view.profile}:dash`,
      title: `${view.name} · Dashboard`,
      subtitle: 'Open panels and records',
      keywords: `${view.name} ${view.profile} dashboard panels`,
      kind: 'bot',
      profile: view.profile,
      mode: 'dashboard',
    }

    return [base, dash]
  })

  const roomCommands: StationCommand[] = rooms.map(room => ({
    id: `room:${room.id}`,
    title: room.name,
    subtitle: room.preview || 'Group room',
    keywords: `${room.name} ${room.id} room group`,
    kind: 'room',
    roomId: room.id,
  }))

  return [...quickActions, ...staticRoutes, ...botCommands, ...roomCommands]
}

export function filterStationCommands(commands: readonly StationCommand[], query: string): StationCommand[] {
  const needle = query.trim().toLowerCase()

  if (!needle) {
    return [...commands]
  }

  const terms = needle.split(/\s+/).filter(Boolean)

  return commands.filter(item => {
    const haystack = `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase()

    return terms.every(term => haystack.includes(term))
  })
}
