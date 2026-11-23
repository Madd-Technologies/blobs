import { startDashboardsSync } from '@/stores/dashboards'
import { inbox, startInboxSync } from '@/stores/inbox'
import { startPhoneSync } from '@/stores/phone'
import { startPresenceSync } from '@/stores/presence'
import { startPushSync } from '@/stores/push'
import { startRestartSync } from '@/stores/restart'
import { startRoomsSync } from '@/stores/rooms'
import { startRosterSync, useRoster } from '@/stores/roster'
import { useSeen } from '@/stores/seen'
import { startStationSync } from '@/stores/station'
import { startVisibleSync } from '@/stores/visible'
import { sessions, startLastChatSync } from '@/stores/sessions'
import { useConnection } from '@/stores/connection'
import { startWatchSync } from '@/stores/watch'

/**
 * Starts everything that keeps the app current: the roster and inbox pollers, this phone's notification
 * registration, unread seeding, and re-attaching open chats whenever the socket reconnects. Returns the function
 * that stops it.
 */
export function startSessionSync(): () => void {
  let stopped = false
  const stops: (() => void)[] = [
    startRosterSync(),
    startInboxSync(),
    startVisibleSync(),
    startWatchSync(),
    startLastChatSync(),
  ]
  const timers: ReturnType<typeof setTimeout>[] = []

  const defer = (delayMs: number, starts: (() => () => void)[]) => {
    timers.push(
      setTimeout(() => {
        if (stopped) {
          return
        }

        for (const start of starts) {
          stops.push(start())
        }
      }, delayMs),
    )
  }

  // Stagger secondary sync subsystems so initial roster + needs-you reads aren't crowded out on cold start.
  defer(350, [startDashboardsSync, startRoomsSync])
  defer(850, [startPhoneSync, startPushSync, startPresenceSync, startRestartSync, startStationSync])

  let generation = useConnection.getState().generation

  const stopConnection = useConnection.subscribe(state => {
    if (state.generation !== generation) {
      generation = state.generation
      void sessions.reattachAll()
      void inbox.refresh()
    }
  })

  // Seed unread marks once the stored ones have loaded, and for any bot that appears later.
  const seed = () => useSeen.getState().seed(useRoster.getState().rows)
  const stopSeed = useRoster.subscribe(() => {
    if (useSeen.persist.hasHydrated()) {
      seed()
    }
  })
  const stopHydration = useSeen.persist.onFinishHydration(seed)

  return () => {
    stopped = true
    timers.forEach(clearTimeout)
    stops.forEach(stop => stop())
    stopConnection()
    stopSeed()
    stopHydration()
  }
}
