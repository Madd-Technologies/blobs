import { matchActiveToBots } from '@/features/attention/derive'
import { attentionFor, deriveInbox, type InboxEntry } from '@/features/inbox/derive'
import { buildDeck } from '@/features/inbox/deck'
import { deriveInFlight } from '@/features/roster/inflight'
import { visibleState } from '@/features/roster/visible'
import { buildBotViews } from '@/features/roster/view'
import { buildRoomViews } from '@/features/rooms/view'
import { buildWidgetSnapshot } from '@/features/station/widgetSnapshot'
import { loadLiveStation } from '@/lib/liveStation'
import { useDashboards } from '@/stores/dashboards'
import { inbox, useOpenChat } from '@/stores/inbox'
import { usePhone } from '@/stores/phone'
import { useRooms } from '@/stores/rooms'
import { useRoster } from '@/stores/roster'
import { useSeen } from '@/stores/seen'
import { sessions } from '@/stores/sessions'
import { useStation } from '@/stores/station'
import { useVisible } from '@/stores/visible'

/**
 * Mirrors current Needs-You counts and in-flight work into iOS Home Screen Widgets and Live Activities.
 */
export function startLiveStationSync(): () => void {
  const native = loadLiveStation()
  if (!native) {
    return () => {}
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let activeActivityId: string | null = null
  let activeKey: string | null = null
  let lastSnapshotJson = ''
  let stopped = false

  const flush = async () => {
    if (stopped) return
    const nowS = Date.now() / 1000
    const rosterRows = useRoster.getState().rows
    const visible = useVisible.getState().byBot
    const sessionBots = sessions.store.getState().bots
    const seenAt = useSeen.getState().seenAt
    const openProfile = useOpenChat.getState().profile
    const inboxState = inbox.store.getState()
    const dash = useDashboards.getState()
    const roomsState = useRooms.getState()
    const phoneState = usePhone.getState()
    const stationState = useStation.getState()

    const knownLiveIds = sessions.knownLiveIds()
    const { entries, byBot } = deriveInbox({
      roster: rosterRows,
      sessions: sessionBots,
      active: inboxState.active,
      polled: inboxState.polled,
      pushed: inboxState.pushed,
      kanban: inboxState.kanban,
      knownLiveIds,
    })
    const activeByBot = matchActiveToBots(rosterRows, inboxState.active, knownLiveIds)

    const attention = Object.fromEntries(
      rosterRows.map(bot => {
        const known = visibleState(visible[bot.name], bot.canonical_session)
        const lastActive = known.kind === 'known' ? known.visible.ts : known.kind === 'pending' ? 0 : undefined
        const turnByYou = known.kind === 'known' ? known.visible.lastTurnYours : undefined
        return [
          bot.name,
          attentionFor(
            bot,
            { inbox: byBot as Map<string, InboxEntry[]>, activeByBot, lastActive, turnByYou },
            { now: nowS, seenAt: seenAt[bot.name], isOpen: openProfile === bot.name },
          ),
        ]
      }),
    )

    const views = buildBotViews({
      roster: rosterRows,
      attention,
      inbox: byBot,
      sessions: sessionBots,
      now: nowS,
      includeHidden: true,
      visible,
      background: inboxState.background,
    })

    const rooms = buildRoomViews(roomsState.rooms, nowS)
    const waitingBots = Object.entries(dash.summary)
      .filter(([, entry]) => entry.needs_you > 0)
      .map(([profile]) => profile)
    const pendingBoard = Object.values(dash.summary).reduce((sum, item) => sum + item.needs_you, 0)
    const cards = buildDeck({
      entries,
      waitingBots,
      held: dash.needsYou,
      rooms,
      nowS,
    })

    const snapshot = buildWidgetSnapshot({
      views,
      rooms,
      cards,
      waitingCount: pendingBoard + entries.length + rooms.filter(room => room.needsYou).length,
      fleetPaused: Boolean(stationState.fleet?.paused),
      nowS,
    })

    const json = JSON.stringify(snapshot)
    if (json !== lastSnapshotJson) {
      lastSnapshotJson = json
      try {
        native.updateWidgetSnapshot(json)
      } catch {
        // Ignore if App Group is absent on unsupported simulator config.
      }
    }

    if (!native.isSupported()) {
      return
    }

    const inFlight = deriveInFlight({
      views,
      rooms,
      errands: phoneState.errands,
      sessions: sessionBots,
      background: inboxState.background,
    })
    const primary = inFlight[0]

    if (!primary) {
      if (activeActivityId) {
        const ending = activeActivityId
        activeActivityId = null
        activeKey = null
        await native.endActivity(ending).catch(() => {})
      }
      return
    }

    const key = primary.kind === 'room' ? primary.roomId : primary.profile
    const label = primary.title
    const detail = primary.subtitle || 'Working'
    const phase = snapshot.needsYouCount > 0 ? 'Waiting' : 'Active'

    if (activeActivityId && activeKey === key) {
      await native.updateActivity(activeActivityId, phase, detail, snapshot.needsYouCount).catch(() => {})
    } else {
      if (activeActivityId) {
        const old = activeActivityId
        activeActivityId = null
        await native.endActivity(old).catch(() => {})
      }
      activeKey = key
      activeActivityId = await native
        .startActivity(label, key, detail, phase, snapshot.needsYouCount)
        .catch(() => null)
    }
  }

  const schedule = () => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), 1000)
  }

  const unsubs = [
    useRoster.subscribe(schedule),
    useStation.subscribe(schedule),
    useDashboards.subscribe(schedule),
    useRooms.subscribe(schedule),
    inbox.store.subscribe(schedule),
  ]

  schedule()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    unsubs.forEach(stop => stop())
    if (activeActivityId) {
      void native.endActivity(activeActivityId).catch(() => {})
    }
  }
}
