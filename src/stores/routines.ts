import { deleteCronJob, listCronJobs, listCronRuns, pauseCronJob, resumeCronJob, runOutcome, triggerCronJob, type CronJob, type CronRun } from '@/lib/hermes/cron'
import { describeError } from '@/lib/hermes/errors'
import { createBotResourceStore } from '@/stores/botResource'
import { useConnection } from '@/stores/connection'

interface BotRoutines {
  jobs: CronJob[] | null
  error: string | null
}

interface RoutinesExtra {
  runs: Record<string, CronRun[] | undefined>
  running: Record<string, true | undefined>
  loadRuns: (profile: string, id: string) => Promise<void>
}

export const runKey = (profile: string, id: string) => `${profile}/${id}`

/** A bot's routines, read when its Routines screen opens and after anything changes them. */
export const useRoutines = createBotResourceStore<BotRoutines, RoutinesExtra>({
  fetch: async (profile, config) => ({ jobs: await listCronJobs(config, profile), error: null }),
  onError: (error, current) => ({ jobs: current?.jobs ?? null, error: describeError(error) }),
  onReset: () => ({ runs: {}, running: {} }),
  extra: set => ({
    runs: {},
    running: {},
    loadRuns: async (profile, id) => {
      const config = useConnection.getState().config

      if (!config) {
        return
      }

      const baseUrl = config.baseUrl

      try {
        const runs = await listCronRuns(config, profile, id)

        if (useConnection.getState().config?.baseUrl === baseUrl) {
          set(state => ({ runs: { ...state.runs, [runKey(profile, id)]: runs } }))
        }
      } catch {
        // History stays as it was; the routine itself still shows.
      }
    },
  }),
})

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
