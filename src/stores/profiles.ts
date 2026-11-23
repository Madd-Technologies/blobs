import { describeError } from '@/lib/hermes/errors'
import type { BotMeta } from '@/lib/hermes/identity'
import { approvalModeOf, browserHeadedOf, changeModel, configureProfile, createBot, describeProfile, disabledSkills, updateBotMeta, type ApprovalMode, type ModelChange, type NewBot } from '@/lib/hermes/profiles'
import type { ModelOptions, ProfileDescription } from '@/lib/hermes/protocol'
import { deleteProfile, getBotConfig, updateBotConfig } from '@/lib/hermes/rest'
import { call } from '@/lib/hermes/rpc'
import { runsOnOf, sshOnServer, type RunsOn } from '@/lib/hermes/runsOn'
import { createBotResourceStore } from '@/stores/botResource'
import { gateway, useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'
import { sessions } from '@/stores/sessions'

/** A bot's description, instructions, model and skills (`profiles.describe`), read when its details open. */
export const useProfileDetail = createBotResourceStore<{ detail: ProfileDescription | null; error: string | null }>({
  fetch: async profile => ({ detail: await describeProfile(gateway, profile), error: null }),
  onError: (error, current) => ({ detail: current?.detail ?? null, error: describeError(error) }),
})

type Outcome = Promise<string | null>

async function attempt(work: () => Promise<void>): Outcome {
  try {
    await work()
    await useRoster.getState().refresh()

    return null
  } catch (error) {
    return describeError(error)
  }
}

export function saveBotMeta(profile: string, patch: Partial<Record<keyof BotMeta, unknown>>): Outcome {
  return attempt(async () => {
    const row = useRoster.getState().rows.find(entry => entry.name === profile)
    await updateBotMeta({ client: gateway }, profile, patch, row)
  })
}

export function saveDescription(profile: string, description: string): Outcome {
  return attempt(async () => {
    const result = await configureProfile(gateway, { name: profile, description })

    if (!result.applied.description) {
      throw new Error('The server did not save the description.')
    }

    await useProfileDetail.getState().load(profile)
  })
}

export function saveInstructions(profile: string, soul: string): Outcome {
  return attempt(async () => {
    const result = await configureProfile(gateway, { name: profile, soul })

    if (!result.applied.soul) {
      throw new Error('The server did not save the instructions.')
    }

    await useProfileDetail.getState().load(profile)
  })
}

export function makeBot(bot: NewBot): Outcome {
  return attempt(async () => {
    await createBot(gateway, bot)
  })
}

export function removeBot(profile: string): Outcome {
  return attempt(async () => {
    const config = useConnection.getState().config

    if (!config) {
      throw new Error('Not connected to a server.')
    }

    await deleteProfile(config, profile)
    sessions.forget(profile)
  })
}

// ── model ────────────────────────────────────────────────────────────────────────────────────────

export const useModelOptions = createBotResourceStore<{ options: ModelOptions | null; error: string | null }>({
  // `explicit_only` hides providers that only have ambient credentials, as Desktop's picker does.
  fetch: async profile => ({ options: await call(gateway, 'model.options', { profile, explicit_only: true }), error: null }),
  onError: (error, current) => ({ options: current?.options ?? null, error: describeError(error) }),
})

export async function saveModel(profile: string, model: string, provider: string, confirmed = false): Promise<ModelChange | { kind: 'error'; message: string }> {
  try {
    const result = await changeModel(gateway, profile, model, provider, confirmed)

    if (result.kind === 'done') {
      await Promise.all([useProfileDetail.getState().load(profile), useModelOptions.getState().load(profile), useRoster.getState().refresh()])
    }

    return result
  } catch (error) {
    return { kind: 'error', message: describeError(error) }
  }
}

// ── skills ───────────────────────────────────────────────────────────────────────────────────────

export function saveSkills(profile: string, skills: { name: string; enabled: boolean }[]): Outcome {
  return attempt(async () => {
    const result = await configureProfile(gateway, { name: profile, disabled_skills: disabledSkills(skills) })

    if (!result.ok || !result.applied.skills) {
      throw new Error('The server did not save the skills.')
    }

    await useProfileDetail.getState().load(profile)
  })
}

// ── approvals ────────────────────────────────────────────────────────────────────────────────────

export const useApprovals = createBotResourceStore<ApprovalMode>({
  fetch: async (profile, config) => approvalModeOf(await getBotConfig(config, profile)),
})

export const useBrowserMode = createBotResourceStore<boolean>({
  fetch: async (profile, config) => browserHeadedOf(await getBotConfig(config, profile)),
})

export function saveApprovalMode(profile: string, mode: ApprovalMode): Outcome {
  return attempt(async () => {
    const config = useConnection.getState().config

    if (!config) {
      throw new Error('Not connected to a server.')
    }

    await updateBotConfig(config, profile, { approvals: { mode } })
    await useApprovals.getState().load(profile)
  })
}

export async function loadBotSettings(profile: string): Promise<void> {
  const config = useConnection.getState().config

  if (!config) {
    return
  }

  try {
    const botConfig = await getBotConfig(config, profile)
    useApprovals.getState().patch(profile, approvalModeOf(botConfig))
    const runsOn = await enrichServerTarget(config, profile, runsOnOf(botConfig))

    if (useConnection.getState().config?.baseUrl === config.baseUrl) {
      useRunsOn.getState().patch(profile, runsOn)
    }
  } catch {
    // Left unknown: the rows show nothing rather than a guess.
  }
}

// ── runs on ──────────────────────────────────────────────────────────────────────────────────────

async function enrichServerTarget(config: Parameters<typeof sshOnServer>[0], profile: string, runsOn: RunsOn): Promise<RunsOn> {
  if (!runsOn.fromServer) {
    return runsOn
  }

  const serverTarget = await sshOnServer(config, profile)

  return serverTarget ? { ...runsOn, serverTarget } : runsOn
}

export const useRunsOn = createBotResourceStore<RunsOn>({
  fetch: async (profile, config) => enrichServerTarget(config, profile, runsOnOf(await getBotConfig(config, profile))),
})

export function saveRunsOn(profile: string, change: { terminal: Record<string, unknown> }): Outcome {
  return attempt(async () => {
    const config = useConnection.getState().config

    if (!config) {
      throw new Error('Not connected to a server.')
    }

    await updateBotConfig(config, profile, change)
    await useRunsOn.getState().load(profile)
  })
}

// ── reload ───────────────────────────────────────────────────────────────────────────────────────

export async function reloadEnv(): Promise<{ updated: number } | { error: string }> {
  try {
    return { updated: (await call(gateway, 'reload.env', {})).updated }
  } catch (error) {
    return { error: describeError(error) }
  }
}
