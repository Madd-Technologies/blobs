import { create } from 'zustand'

import { describeError } from '@/features/sessions/store'
import type { BotMeta } from '@/lib/hermes/identity'
import { approvalModeOf, browserHeadedOf, changeModel, configureProfile, createBot, describeProfile, disabledSkills, updateBotMeta, type ApprovalMode, type ModelChange, type NewBot } from '@/lib/hermes/profiles'
import type { ModelOptions, ProfileDescription } from '@/lib/hermes/protocol'
import { deleteProfile, getBotConfig, updateBotConfig } from '@/lib/hermes/rest'
import { call } from '@/lib/hermes/rpc'
import { gateway, useConnection } from '@/stores/connection'
import { useRoster } from '@/stores/roster'
import { sessions } from '@/stores/sessions'

interface DetailState {
  /** What the server says each bot is made of, as last read. Kept per bot; absent until the first read finishes. */
  byBot: Record<string, { detail: ProfileDescription | null; error: string | null } | undefined>
  load: (profile: string) => Promise<void>
}

/** A bot's description, instructions, model and skills (`profiles.describe`), read when its details open. */
export const useProfileDetail = create<DetailState>(set => ({
  byBot: {},
  load: async profile => {
    try {
      const detail = await describeProfile(gateway, profile)
      set(state => ({ byBot: { ...state.byBot, [profile]: { detail, error: null } } }))
    } catch (error) {
      set(state => ({ byBot: { ...state.byBot, [profile]: { detail: state.byBot[profile]?.detail ?? null, error: describeError(error) } } }))
    }
  },
}))

/** Every write below returns an error to show, or null when it worked, and leaves the roster fresh. */
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

/** Changes the look and settings the app keeps for a bot (name shown, shape, color, pinned, hidden). */
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

interface ModelState {
  /** The providers and models a bot can use, as last read; absent until the first read finishes. */
  byBot: Record<string, { options: ModelOptions | null; error: string | null } | undefined>
  load: (profile: string) => Promise<void>
}

export const useModelOptions = create<ModelState>(set => ({
  byBot: {},
  load: async profile => {
    try {
      // `explicit_only` hides providers that only have ambient credentials, as Desktop's picker does.
      const options = await call(gateway, 'model.options', { profile, explicit_only: true })
      set(state => ({ byBot: { ...state.byBot, [profile]: { options, error: null } } }))
    } catch (error) {
      set(state => ({ byBot: { ...state.byBot, [profile]: { options: state.byBot[profile]?.options ?? null, error: describeError(error) } } }))
    }
  },
}))

/** Picks a bot's model. A model the server flags comes back as `confirm`; call again with `confirmed`. */
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

/** Saves which skills are on. The server takes the whole list of disabled ones. */
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

interface ApprovalState {
  byBot: Record<string, ApprovalMode | undefined>
  load: (profile: string) => Promise<void>
}

/** How each bot asks before a risky command: read from its config when its details open. */
export const useApprovals = create<ApprovalState>(set => ({
  byBot: {},
  load: async profile => {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      const mode = approvalModeOf(await getBotConfig(config, profile))
      set(state => ({ byBot: { ...state.byBot, [profile]: mode } }))
    } catch {
      // Left unknown: the row shows nothing rather than a guess.
    }
  },
}))

interface BrowserModeState {
  byBot: Record<string, boolean | undefined>
  load: (profile: string) => Promise<void>
}

/** Whether each bot's browser tool runs in a visible window (`browser.headed`), read from its config. */
export const useBrowserMode = create<BrowserModeState>(set => ({
  byBot: {},
  load: async profile => {
    const config = useConnection.getState().config

    if (!config) {
      return
    }

    try {
      const headed = browserHeadedOf(await getBotConfig(config, profile))
      set(state => ({ byBot: { ...state.byBot, [profile]: headed } }))
    } catch {
      // Left unknown, which counts as headless: a browser step then offers no screen to open.
    }
  },
}))

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

// ── reload ───────────────────────────────────────────────────────────────────────────────────────

/** Re-reads the server's `.env`: new keys work on the next call. Returns how many changed, or an error to show. */
export async function reloadEnv(): Promise<{ updated: number } | { error: string }> {
  try {
    return { updated: (await call(gateway, 'reload.env', {})).updated }
  } catch (error) {
    return { error: describeError(error) }
  }
}
