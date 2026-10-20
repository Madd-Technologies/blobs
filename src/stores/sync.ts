import { startDashboardsSync } from '@/stores/dashboards'
import { inbox, startInboxSync } from '@/stores/inbox'
import { startPhoneSync } from '@/stores/phone'
import { startPresenceSync } from '@/stores/presence'
import { startPushSync } from '@/stores/push'
import { startRestartSync } from '@/stores/restart'
import { startRoomsSync } from '@/stores/rooms'
import { startRosterSync, useRoster } from '@/stores/roster'
import { useSeen } from '@/stores/seen'
import { startVisibleSync } from '@/stores/visible'
import { sessions, startLastChatSync } from '@/stores/sessions'
import { useConnection } from '@/stores/connection'

/**
 * Starts everything that keeps the app current: the roster and inbox pollers, this phone's notification
 * registration, unread seeding, and re-attaching open chats whenever the socket reconnects. Returns the function
 * that stops it.
 */
export function startSessionSync(): () => void {
  const stopRoster = startRosterSync()
  const stopInbox = startInboxSync()
  const stopRooms = startRoomsSync()
  const stopDashboards = startDashboardsSync()
  const stopPhone = startPhoneSync()
  const stopVisible = startVisibleSync()
  const stopPush = startPushSync()
  const stopPresence = startPresenceSync()
  const stopLastChat = startLastChatSync()
  const stopRestart = startRestartSync()
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
    stopRoster()
    stopInbox()
    stopRooms()
    stopDashboards()
    stopPhone()
    stopVisible()
    stopPush()
    stopPresence()
    stopLastChat()
    stopRestart()
    stopConnection()
    stopSeed()
    stopHydration()
  }
}
