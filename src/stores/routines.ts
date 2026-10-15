import { create } from 'zustand'

import { describeError } from '@/features/sessions/store'
import { deleteCronJob, listCronJobs, listCronRuns, pauseCronJob, resumeCronJob, runOutcome, triggerCronJob, type CronJob, type CronRun } from '@/lib/hermes/cron'
import { useConnection } from '@/stores/connection'

interface BotRoutines {
  /** Null until the first read finishes. */
  jobs: CronJob[] | null
  error: string | null
}

interface RoutinesState {
  byBot: Record<string, BotRoutines | undefined>
  /** A routine's recent runs, newest first, keyed `<bot>/<job id>`. */
  runs: Record<string, CronRun[] | undefined>
  /** Routines that were just started from the app and are still going, keyed the same way. */
  running: Record<string, true | undefined>
  load: (profile: string) => Promise<void>
  loadRuns: (profile: string, id: string) => Promise<void>
}

export const runKey = (profile: string, id: string) => `${profile}/${id}`

/** A bot's routines, read when its Routines screen opens and after anything changes them. */
export const useRoutines = create<RoutinesState>(set => ({
  byBot: {},
  runs: {},
  running: {},
  load: async profile => {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      const jobs = await listCronJobs(config, profile)
      set(state => ({ byBot: { ...state.byBot, [profile]: { jobs, error: null } } }))
    } catch (error) {
      set(state => ({ byBot: { ...state.byBot, [profile]: { jobs: state.byBot[profile]?.jobs ?? null, error: describeError(error) } } }))
    }
  },
  loadRuns: async (profile, id) => {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      const runs = await listCronRuns(config, profile, id)
      set(state => ({ runs: { ...state.runs, [runKey(profile, id)]: runs } }))
    } catch {
      // The history stays as it was; the routine itself still shows.
    }
  },
}))

/** Every change below returns an error to show, or null when it worked. */
type Outcome = Promise<string | null>

function configOrThrow() {
  const config = useConnection.getState().config

  if (!config) {
    throw new Error('Not connected to a server.')
  }

  return config
}

export async function setRoutineOn(profile: string, id: string, on: boolean): Outcome {
  try {
    const config = configOrThrow()
    await (on ? resumeCronJob : pauseCronJob)(config, profile, id)
    await useRoutines.getState().load(profile)

    return null
  } catch (error) {
    return describeError(error)
  }
}

export async function removeRoutine(profile: string, id: string): Outcome {
  try {
    await deleteCronJob(configOrThrow(), profile, id)
    await useRoutines.getState().load(profile)

    return null
  } catch (error) {
    return describeError(error)
  }
}

const WATCH_EVERY_MS = 5000
const WATCH_FOR_MS = 3 * 60_000

/**
 * Starts a run and keeps the screen current while it goes: "Run now" returns after a few seconds whether or not the
 * job has finished, so the run's history is re-read until its newest run ends (or three minutes pass).
 * Returns an error to show, or `busy` when it was already running.
 */
export async function runRoutineNow(profile: string, id: string): Promise<string | null | 'busy'> {
  const key = runKey(profile, id)
  const store = useRoutines

  try {
    const config = configOrThrow()
    store.setState(state => ({ running: { ...state.running, [key]: true } }))

    if ((await triggerCronJob(config, profile, id)) === 'busy') {
      return 'busy'
    }

    const deadline = Date.now() + WATCH_FOR_MS

    for (;;) {
      await Promise.all([store.getState().load(profile), store.getState().loadRuns(profile, id)])
      const newest = store.getState().runs[key]?.[0]

      if (newest && runOutcome(newest) !== 'running') {
        break
      }

      if (Date.now() > deadline) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, WATCH_EVERY_MS))
    }

    return null
  } catch (error) {
    return describeError(error)
  } finally {
    store.setState(state => {
      const { [key]: _done, ...rest } = state.running

      return { running: rest }
    })
  }
}
