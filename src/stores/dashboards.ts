import { create } from 'zustand'

import { dashboardRoutines, refreshedSince } from '@/features/dashboard/view'
import { describeError } from '@/features/sessions/store'
import { listCronJobs, triggerCronJob, type CronJob } from '@/lib/hermes/cron'
import { addRecordNote, changeRecord, DraftChanged, getBotDashboard, type View, getDashboardsSummary, getNeedsYou, getRecord, muteRecord, OldDashboardPlugin, pressAction, setRecordClosed, type BotDashboard, type DashboardsSummary, type NeedsYouRecord, type RecordDetail } from '@/lib/hermes/dashboard'
import { DASHBOARD_CHANGED, parseDashboardChanged } from '@/lib/hermes/livepush'
import { startPoller } from '@/lib/poller'
import { onGatewayEvent, useConnection } from '@/stores/connection'
import { sessions } from '@/stores/sessions'
import { isShown, pushes } from '@/stores/watch'

export interface BotBoard {
  dashboard: BotDashboard | null
  loaded: boolean
  error: string | null
  /** The server's plugin is 0.1, which this app no longer draws. */
  old?: boolean
}

interface DashboardsState {
  /** Whether the server has hermes-dashboard: null until known. Without it, pinned bots open their chat as before. */
  available: boolean | null
  summary: DashboardsSummary['bots']
  byBot: Record<string, BotBoard>
  records: Record<string, RecordDetail | undefined>
  /** What each bot's dashboard holds for you, for Needs you, with the server's clock. */
  needsYou: Record<string, { records: NeedsYouRecord[]; now: number }>
  /** The routines that keep each bot's dashboard (undefined until read). */
  keepers: Record<string, CronJob[] | undefined>
  /** Bots whose dashboard routines were started with "Check now" and have not written yet. */
  checking: Record<string, true>
  /** Each bot's dashboard version as the server last pushed it (hermes-dashboard 0.7+): an open record reloads when it moves. */
  pushed: Record<string, string>
  refreshSummary: () => Promise<void>
  /** Re-reads a bot's dashboard (only what changed comes back); `fresh` reads its live panels' sources now. */
  load: (profile: string, options?: { fresh?: boolean }) => Promise<void>
  loadRecord: (id: string) => Promise<string | null>
  loadNeedsYou: (profile: string) => Promise<void>
  loadKeepers: (profile: string) => Promise<CronJob[]>
  /** Your actions on a record. Each returns an error to show, or null. */
  change: (profile: string, id: string, values: Record<string, unknown>) => Promise<string | null>
  setClosed: (profile: string, id: string, closed: boolean) => Promise<string | null>
  note: (profile: string, id: string, text: string) => Promise<string | null>
  /** Mutes a record until a time (server seconds), or unmutes it (null). */
  mute: (profile: string, id: string, until: number | null) => Promise<string | null>
  /** You pressed a record's button: a fresh side chat with the bot gets the job (and is then the chat the bot shows). */
  press: (profile: string, id: string, action: string) => Promise<string | null>
  /**
   * You approved a draft and pressed its button: like `press`, carrying the draft's digest as you saw it. `{ changed }` (its
   * digest now) when it changed since: nothing was sent, and the record is read again for you to look at.
   */
  approve: (profile: string, id: string, action: string, digest: string) => Promise<string | null | { changed: string }>
  /** Runs the routines that keep this dashboard now. Returns how many started, or an error. */
  checkNow: (profile: string) => Promise<{ started: number } | { error: string }>
  /** A panel's "Refresh now" / "Check now": a live panel reads its source now, a panel with a recorded job runs that job,
   * anything else runs the routines that keep the dashboard. */
  checkPanel: (profile: string, view: View) => Promise<{ started: number } | { error: string }>
  reset: () => void
}

const empty: BotBoard = { dashboard: null, loaded: false, error: null }

/** After "Check now": read the dashboard this often, for at most this long (a routine that reads a whole inbox can take several minutes). */
const WATCH_EVERY_MS = 5_000
const WATCH_MS = 10 * 60_000

export const useDashboards = create<DashboardsState>((set, get) => {
  let summaryBusy = false
  const loading = new Set<string>()

  const config = () => useConnection.getState().config

  /** After you change a record: it, its bot's dashboard, what it holds for you and the summary are read again. */
  async function after(profile: string, id: string) {
    await Promise.all([get().loadRecord(id), get().load(profile), get().loadNeedsYou(profile), get().refreshSummary()])
  }

  async function act(profile: string, id: string, run: () => Promise<unknown>): Promise<string | null> {
    if (!config()) {
      return 'Not connected to the server.'
    }

    try {
      await run()
      await after(profile, id)

      return null
    } catch (error) {
      return describeError(error)
    }
  }

  async function watch(profile: string, sinceS: number) {
    const deadline = Date.now() + WATCH_MS

    while (Date.now() < deadline && get().checking[profile]) {
      await new Promise(resolve => setTimeout(resolve, WATCH_EVERY_MS))
      await get().load(profile)

      if (refreshedSince(get().byBot[profile]?.dashboard?.views ?? [], sinceS)) {
        break
      }
    }

    set(state => {
      const checking = { ...state.checking }
      delete checking[profile]

      return { checking }
    })
    void get().refreshSummary()
  }

  return {
    available: null,
    summary: {},
    byBot: {},
    records: {},
    needsYou: {},
    keepers: {},
    checking: {},
    pushed: {},

    refreshSummary: async () => {
      const current = config()

      if (!current || summaryBusy) {
        return
      }

      summaryBusy = true

      try {
        const answer = await getDashboardsSummary(current)
        set(answer ? { available: true, summary: answer.bots } : { available: false, summary: {} })
      } catch {
        // The next poll tries again; what is shown stays.
      } finally {
        summaryBusy = false
      }
    },

    load: async (profile, options = {}) => {
      const current = config()

      if (!current || (loading.has(profile) && !options.fresh)) {
        return
      }

      loading.add(profile)

      try {
        const shown = get().byBot[profile]?.dashboard
        const dashboard = await getBotDashboard(current, profile, { since: options.fresh ? undefined : shown?.version, fresh: options.fresh })

        if (dashboard === 'unchanged') {
          // Nothing on it changed since the last read: keep what is shown (and skip a re-render).
          if (get().byBot[profile]?.error) {
            set(state => ({ byBot: { ...state.byBot, [profile]: { ...(state.byBot[profile] ?? empty), loaded: true, error: null } } }))
          }

          return
        }

        set(state => (dashboard ? { available: true, byBot: { ...state.byBot, [profile]: { dashboard, loaded: true, error: null } } } : { available: false, byBot: { ...state.byBot, [profile]: { ...empty, loaded: true } } }))
      } catch (error) {
        const old = error instanceof OldDashboardPlugin
        set(state => ({ byBot: { ...state.byBot, [profile]: { ...(state.byBot[profile] ?? empty), loaded: true, old, error: describeError(error) } } }))
      } finally {
        loading.delete(profile)
      }
    },

    loadRecord: async id => {
      const current = config()

      if (!current) {
        return 'Not connected to the server.'
      }

      try {
        const detail = await getRecord(current, id)
        set(state => ({ records: { ...state.records, [id]: detail } }))

        return null
      } catch (error) {
        return describeError(error)
      }
    },

    loadNeedsYou: async profile => {
      const current = config()

      if (!current) {
        return
      }

      try {
        const answer = await getNeedsYou(current, profile)
        set(state => ({ needsYou: { ...state.needsYou, [profile]: answer } }))
      } catch {
        // What is shown stays until the next read.
      }
    },

    loadKeepers: async profile => {
      const current = config()

      if (!current) {
        return []
      }

      const routines = dashboardRoutines(await listCronJobs(current, profile))
      set(state => ({ keepers: { ...state.keepers, [profile]: routines } }))

      return routines
    },

    change: (profile, id, values) => act(profile, id, () => changeRecord(config()!, id, values)),
    setClosed: (profile, id, closed) => act(profile, id, () => setRecordClosed(config()!, id, closed)),
    note: (profile, id, text) => act(profile, id, () => addRecordNote(config()!, id, text)),
    mute: (profile, id, until) => act(profile, id, () => muteRecord(config()!, id, until)),

    press: async (profile, id, action) => {
      const current = config()

      if (!current) {
        return 'Not connected to the server.'
      }

      // The job gets its own side chat, so the bot's main chat is not interrupted and the person can watch it there.
      const failed = await sessions.newChat(profile)

      if (failed) {
        return failed
      }

      try {
        const { message } = await pressAction(current, id, action, sessions.store.getState().chosen[profile] ?? null)
        const sent = await sessions.send(profile, message)
        void after(profile, id)

        return sent ? null : 'The side chat didn’t take the job. Open it and try again.'
      } catch (error) {
        return describeError(error)
      }
    },

    approve: async (profile, id, action, digest) => {
      const current = config()

      if (!current) {
        return 'Not connected to the server.'
      }

      const failed = await sessions.newChat(profile)

      if (failed) {
        return failed
      }

      try {
        const { message } = await pressAction(current, id, action, sessions.store.getState().chosen[profile] ?? null, digest)
        const sent = await sessions.send(profile, message)
        void after(profile, id)

        return sent ? null : 'The side chat didn’t take the job. Open it and try again.'
      } catch (error) {
        if (error instanceof DraftChanged) {
          // Nothing started: leave the fresh side chat and show the new version.
          void sessions.leaveSide(profile)
          await get().loadRecord(id)

          return { changed: error.current }
        }

        return describeError(error)
      }
    },

    checkNow: async profile => {
      const current = config()

      if (!current) {
        return { error: 'Not connected to the server.' }
      }

      if (get().checking[profile]) {
        return { started: 0 }
      }

      try {
        await get().load(profile)
        const sinceS = get().byBot[profile]?.dashboard?.now || Math.round(Date.now() / 1000)
        const routines = await get().loadKeepers(profile)

        if (!routines.length) {
          return { started: 0 }
        }

        set(state => ({ checking: { ...state.checking, [profile]: true } }))
        await Promise.all(routines.map(job => triggerCronJob(current, profile, job.id)))
        void watch(profile, sinceS)

        return { started: routines.length }
      } catch (error) {
        set(state => {
          const checking = { ...state.checking }
          delete checking[profile]

          return { checking }
        })

        return { error: describeError(error) }
      }
    },

    checkPanel: async (profile, view) => {
      const current = config()

      if (!current) {
        return { error: 'Not connected to the server.' }
      }

      if (view.kept?.how === 'live') {
        await get().load(profile, { fresh: true })

        return { started: 1 }
      }

      const job = view.kept?.how === 'computed' ? view.kept.feed?.job : undefined

      if (!job || get().checking[profile]) {
        return get().checkNow(profile)
      }

      try {
        await get().load(profile)
        const sinceS = get().byBot[profile]?.dashboard?.now || Math.round(Date.now() / 1000)
        set(state => ({ checking: { ...state.checking, [profile]: true } }))
        await triggerCronJob(current, profile, job)
        void watch(profile, sinceS)

        return { started: 1 }
      } catch (error) {
        set(state => {
          const checking = { ...state.checking }
          delete checking[profile]

          return { checking }
        })

        return { error: describeError(error) }
      }
    },

    reset: () => set({ available: null, summary: {}, byBot: {}, records: {}, needsYou: {}, keepers: {}, checking: {}, pushed: {} }),
  }
})

/**
 * Keeps each bot's dashboard summary current for the dots on Home: pushed by the server when anything on a dashboard moves
 * (hermes-dashboard 0.7+), which also reloads a dashboard that is on screen; otherwise asked every 30 s in the foreground.
 * With the push, the ask is a safety check every 2 minutes.
 */
export function startDashboardsSync(): () => void {
  const online = () => useConnection.getState().status === 'online'
  const stopPoll = startPoller(() => void useDashboards.getState().refreshSummary(), () => (pushes('dashboardChanged') ? 120_000 : 30_000), online)
  const stopEvents = onGatewayEvent(event => {
    if ((event.type as string) !== DASHBOARD_CHANGED) {
      return
    }

    const change = parseDashboardChanged(event.payload)

    if (!change) {
      return
    }

    const store = useDashboards.getState()

    if (change.summary && JSON.stringify(change.summary) !== JSON.stringify(store.summary)) {
      useDashboards.setState({ available: true, summary: change.summary })
    }

    if (Object.keys(change.versions).length) {
      useDashboards.setState(state => ({ pushed: { ...state.pushed, ...change.versions } }))
    }

    for (const [bot, version] of Object.entries(change.versions)) {
      // Only what is on screen loads now; a dashboard opened later loads then.
      if (isShown('dashboards', bot) && store.byBot[bot]?.dashboard?.version !== version) {
        void store.load(bot)
      }
    }
  })
  const stopConnection = useConnection.subscribe((state, previous) => {
    // Another server: nothing of the last one's dashboards applies.
    if (state.config?.baseUrl !== previous.config?.baseUrl) {
      useDashboards.getState().reset()
    }

    if (state.status === 'online' && previous.status !== 'online') {
      void useDashboards.getState().refreshSummary()
    }
  })

  return () => {
    stopPoll()
    stopEvents()
    stopConnection()
  }
}

/**
 * One bot's dashboard while it is on screen (and the app is in front): read when it opens, then pushed by the server when it
 * changes (hermes-dashboard 0.7+, with a safety check every minute), or asked about every 5 s without the push. Each ask sends
 * the version it has, so the server answers "unchanged" without computing anything unless something moved.
 */
export function startDashboardPoll(profile: string): () => void {
  return startPoller(() => void useDashboards.getState().load(profile), () => (pushes('dashboardChanged') ? 60_000 : 5_000), () => useConnection.getState().status === 'online')
}

export function useBotBoard(profile: string): BotBoard {
  return useDashboards(state => state.byBot[profile] ?? empty)
}
