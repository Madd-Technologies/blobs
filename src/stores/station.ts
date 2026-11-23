import { AppState } from 'react-native'
import { create } from 'zustand'

import { describeError } from '@/lib/hermes/errors'
import {
  ackBriefing,
  getActivity,
  getFleet,
  getQuietHours,
  getTelemetry,
  pauseFleet,
  resumeFleet,
  setQuietHours,
  type ActivitySummary,
  type FleetStatus,
  type QuietHoursConfig,
  type TelemetrySummary,
} from '@/lib/hermes/station'
import { useConnection } from '@/stores/connection'
import { registerServerReset } from '@/stores/reset'

interface StationState {
  available: boolean | null
  briefing: ActivitySummary | null
  quiet: QuietHoursConfig | null
  fleet: FleetStatus | null
  telemetry: TelemetrySummary | null
  telemetryDays: number
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  refreshBriefing: () => Promise<void>
  ackBriefing: () => Promise<string | null>
  refreshQuiet: () => Promise<void>
  updateQuiet: (patch: Partial<QuietHoursConfig>) => Promise<string | null>
  silenceFor: (seconds: number) => Promise<string | null>
  refreshFleet: () => Promise<void>
  pauseFleet: (reason?: string) => Promise<string | null>
  resumeFleet: () => Promise<string | null>
  loadTelemetry: (days?: number) => Promise<string | null>
  reset: () => void
}

const EMPTY = {
  available: null as boolean | null,
  briefing: null as ActivitySummary | null,
  quiet: null as QuietHoursConfig | null,
  fleet: null as FleetStatus | null,
  telemetry: null as TelemetrySummary | null,
  telemetryDays: 7,
  busy: false,
  error: null as string | null,
}

export const useStation = create<StationState>((set, get) => {
  const activeConfig = () => useConnection.getState().config

  return {
    ...EMPTY,

    reset: () => set(EMPTY),

    refresh: async () => {
      const cfg = activeConfig()
      if (!cfg) return
      const server = cfg.baseUrl

      set({ busy: true, error: null })
      try {
        const [briefing, quiet, fleet] = await Promise.all([
          getActivity(cfg),
          getQuietHours(cfg),
          getFleet(cfg),
        ])
        if (activeConfig()?.baseUrl !== server) return
        const available = briefing !== null || quiet !== null || fleet !== null
        set({ available, briefing, quiet, fleet, busy: false })
      } catch (error) {
        if (activeConfig()?.baseUrl !== server) return
        set({ busy: false, error: describeError(error) })
      }
    },

    refreshBriefing: async () => {
      const cfg = activeConfig()
      if (!cfg) return
      const server = cfg.baseUrl

      try {
        const briefing = await getActivity(cfg)
        if (activeConfig()?.baseUrl !== server) return
        set(state => ({
          briefing,
          available: briefing !== null ? true : state.available,
        }))
      } catch (error) {
        if (activeConfig()?.baseUrl === server) set({ error: describeError(error) })
      }
    },

    ackBriefing: async () => {
      const cfg = activeConfig()
      if (!cfg) return 'Not connected'
      const server = cfg.baseUrl

      try {
        const res = await ackBriefing(cfg)
        if (activeConfig()?.baseUrl !== server) return null
        if (!res) return 'Update hermes-bot-mobile on your server.'
        await get().refreshBriefing()
        return null
      } catch (error) {
        return describeError(error)
      }
    },

    refreshQuiet: async () => {
      const cfg = activeConfig()
      if (!cfg) return
      const server = cfg.baseUrl

      try {
        const quiet = await getQuietHours(cfg)
        if (activeConfig()?.baseUrl !== server) return
        set(state => ({ quiet, available: quiet !== null ? true : state.available }))
      } catch (error) {
        if (activeConfig()?.baseUrl === server) set({ error: describeError(error) })
      }
    },

    updateQuiet: async patch => {
      const cfg = activeConfig()
      if (!cfg) return 'Not connected'
      const server = cfg.baseUrl

      try {
        const quiet = await setQuietHours(cfg, patch)
        if (activeConfig()?.baseUrl !== server) return null
        if (!quiet) return 'Update hermes-bot-mobile on your server.'
        set({ quiet, available: true })
        return null
      } catch (error) {
        return describeError(error)
      }
    },

    silenceFor: seconds => {
      const until = seconds > 0 ? Math.floor(Date.now() / 1000) + seconds : null
      return get().updateQuiet({ muted_until: until })
    },

    refreshFleet: async () => {
      const cfg = activeConfig()
      if (!cfg) return
      const server = cfg.baseUrl

      try {
        const fleet = await getFleet(cfg)
        if (activeConfig()?.baseUrl !== server) return
        set(state => ({ fleet, available: fleet !== null ? true : state.available }))
      } catch (error) {
        if (activeConfig()?.baseUrl === server) set({ error: describeError(error) })
      }
    },

    pauseFleet: async (reason = '') => {
      const cfg = activeConfig()
      if (!cfg) return 'Not connected'
      const server = cfg.baseUrl

      try {
        const fleet = await pauseFleet(cfg, reason)
        if (activeConfig()?.baseUrl !== server) return null
        if (!fleet) return 'Update hermes-bot-mobile on your server.'
        set({ fleet, available: true })
        return null
      } catch (error) {
        return describeError(error)
      }
    },

    resumeFleet: async () => {
      const cfg = activeConfig()
      if (!cfg) return 'Not connected'
      const server = cfg.baseUrl

      try {
        const fleet = await resumeFleet(cfg)
        if (activeConfig()?.baseUrl !== server) return null
        if (!fleet) return 'Update hermes-bot-mobile on your server.'
        set({ fleet, available: true })
        return null
      } catch (error) {
        return describeError(error)
      }
    },

    loadTelemetry: async (days = get().telemetryDays) => {
      const cfg = activeConfig()
      if (!cfg) return 'Not connected'
      const server = cfg.baseUrl

      set({ telemetryDays: days, busy: true, error: null })
      try {
        const telemetry = await getTelemetry(cfg, days)
        if (activeConfig()?.baseUrl !== server) return null
        set({ telemetry, busy: false, available: telemetry !== null ? true : get().available })
        return telemetry ? null : 'Update hermes-bot-mobile on your server.'
      } catch (error) {
        if (activeConfig()?.baseUrl === server) set({ busy: false, error: describeError(error) })
        return describeError(error)
      }
    },
  }
})

registerServerReset(() => useStation.getState().reset())

export function startStationSync(): () => void {
  let prevOnline = useConnection.getState().status === 'online'
  let prevGen = useConnection.getState().generation

  if (prevOnline) {
    void useStation.getState().refresh()
  }

  const stopConn = useConnection.subscribe(state => {
    const online = state.status === 'online'
    if (online && (!prevOnline || state.generation !== prevGen)) {
      void useStation.getState().refresh()
    }
    prevOnline = online
    prevGen = state.generation
  })

  const subApp = AppState.addEventListener('change', next => {
    if (next === 'active' && useConnection.getState().status === 'online') {
      void useStation.getState().refresh()
    }
  })

  return () => {
    stopConn()
    subApp.remove()
  }
}
