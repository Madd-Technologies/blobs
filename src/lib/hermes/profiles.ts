/**
 * Reading and changing a bot (a Hermes profile): the typed calls, and the rules for changing the look and settings
 * the app stores in a profile's `ui_meta`. Pure: no React Native imports.
 */

import type { BotMeta } from './identity.ts'
import type { ModelOptions, ProfileConfigureParams, ProfileConfigureResult, ProfileCreateResult, ProfileDescription, ProfileRow } from './protocol.ts'
import { call, type RpcClient } from './rpc.ts'

/** Profiles the app never deletes or edits the identity of: the server's own (`default`). */
export const PROTECTED_PROFILES = ['default'] as const

export const isProtectedProfile = (name: string) => (PROTECTED_PROFILES as readonly string[]).includes(name)

/** What the server accepts as a profile name. */
export const BOT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** A profile name for a display name: "Date night!" -> "date-night". Empty when nothing usable is left. */
export function slugifyName(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
}

/** The key the app stores its per-bot settings under in `ui_meta`. */
export const META_KEY = 'hermes-bots'

/** `patch` laid over `current`; a value of `undefined` leaves a key alone, and `null` clears it. */
export function mergeBotMeta(current: BotMeta | undefined, patch: Partial<Record<keyof BotMeta, unknown>>): BotMeta {
  const merged: Record<string, unknown> = { ...current }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue
    }

    if (value === null) {
      delete merged[key]
    } else {
      merged[key] = value
    }
  }

  return merged as BotMeta
}

export interface MetaDeps {
  client: RpcClient
  /** A fresh read of one bot, for when a write loses a race. */
  readRow?: (name: string) => Promise<ProfileRow | undefined>
}

export class MetaConflictError extends Error {
  constructor() {
    super('This bot was changed somewhere else. Try again.')
    this.name = 'MetaConflictError'
  }
}

async function readRowDefault(client: RpcClient, name: string): Promise<ProfileRow | undefined> {
  return (await call(client, 'profiles.list', {})).profiles.find(row => row.name === name)
}

/**
 * Changes a bot's `ui_meta['hermes-bots']`. The server replaces the whole object under a key, so this always sends the
 * full merged object, guarded by the revision it read; if someone else wrote first, it reads again and tries once more.
 * Returns the object as stored.
 */
export async function updateBotMeta(deps: MetaDeps, name: string, patch: Partial<Record<keyof BotMeta, unknown>>, row?: ProfileRow): Promise<BotMeta> {
  const readRow = deps.readRow ?? ((target: string) => readRowDefault(deps.client, target))
  let source = row

  for (let attempt = 0; attempt < 2; attempt++) {
    source ??= await readRow(name)
    const merged = mergeBotMeta(source?.ui_meta?.[META_KEY], patch)
    const result = await call(deps.client, 'profiles.configure', {
      name,
      ui_meta: { [META_KEY]: merged },
      ui_meta_expected_revisions: { [META_KEY]: source?.ui_meta_revisions?.[META_KEY] ?? 0 },
    })

    if (result.applied.ui_meta) {
      return merged
    }

    // Lost the race (or the object is too large): look again, once.
    source = undefined
  }

  throw new MetaConflictError()
}

export function describeProfile(client: RpcClient, name: string): Promise<ProfileDescription> {
  return call(client, 'profiles.describe', { name })
}

/** Applies one or more sections (description, instructions, skills, ...). Returns what the server says it did. */
export function configureProfile(client: RpcClient, params: ProfileConfigureParams): Promise<ProfileConfigureResult> {
  return call(client, 'profiles.configure', params)
}

export type ModelChange = { kind: 'done' } | { kind: 'confirm'; message: string } | { kind: 'failed' }

/**
 * Picks a bot's model. A model the server flags (cost) is not written until the person confirms: the first call returns
 * `confirm`, and calling again with `confirmed` writes it.
 */
export async function changeModel(client: RpcClient, name: string, model: string, provider: string, confirmed = false): Promise<ModelChange> {
  const result = await configureProfile(client, { name, model, provider, ...(confirmed ? { confirm_expensive_model: true } : {}) })

  if (result.confirm_required) {
    return { kind: 'confirm', message: result.confirm_message ?? 'This model may cost more than usual.' }
  }

  return result.ok && result.applied.model ? { kind: 'done' } : { kind: 'failed' }
}

export interface NewBot {
  /** The display name, as typed. */
  title: string
  /** The profile name: `slugifyName(title)` unless changed. */
  name: string
  description: string
  soul: string
}

/**
 * Makes a bot: a copy of the default profile (so it has the same skills and the same sign-ins), then its look. The
 * look is a separate write because `profiles.create` does not take `ui_meta`; a fresh profile has revision 0.
 */
export async function createBot(client: RpcClient, bot: NewBot, now: () => number = Date.now): Promise<ProfileCreateResult> {
  if (!BOT_NAME.test(bot.name)) {
    throw new Error('A name can use lowercase letters, numbers, - and _, and must start with a letter or number.')
  }

  const created = await call(client, 'profiles.create', {
    name: bot.name,
    description: bot.description.trim(),
    clone_from: 'default',
    share_auth: true,
    ...(bot.soul.trim() ? { soul: bot.soul } : {}),
  })

  await call(client, 'profiles.configure', {
    name: created.name,
    ui_meta: { [META_KEY]: { shape: 'blobatar', title: bot.title.trim() || bot.name, created: now() } },
  })

  return created
}

// ── model ────────────────────────────────────────────────────────────────────────────────────────

export interface ModelSection {
  slug: string
  name: string
  /** Models to show, the bot's own first when it is in this provider. */
  models: string[]
  /** How many more this provider has that are not shown. */
  hidden: number
  warning?: string
}

/** Models one provider shows without being asked for more. */
const DEFAULT_SHOWN = 8
/** Most matches shown while searching: a catalog can hold hundreds. */
const MAX_MATCHES = 60

/**
 * The picker's providers and models. Normally a short list per provider (the newest ones, where the server says which,
 * with the bot's own always first); `expanded` providers show everything; a search shows every match across providers.
 * The bot's provider comes first.
 */
export function modelSections(options: ModelOptions, query: string, expanded: ReadonlySet<string> = new Set()): ModelSection[] {
  const needle = query.trim().toLowerCase()
  const sections: ModelSection[] = []

  for (const row of options.providers) {
    const all = row.models ?? []
    const current = row.slug === options.provider ? options.model : ''

    if (needle) {
      const providerMatches = row.name.toLowerCase().includes(needle) || row.slug.toLowerCase().includes(needle)
      const matches = all.filter(model => providerMatches || model.toLowerCase().includes(needle)).slice(0, MAX_MATCHES)

      if (matches.length) {
        sections.push({ slug: row.slug, name: row.name, models: matches, hidden: 0, warning: row.warning })
      }

      continue
    }

    if (!all.length && !current) {
      continue
    }

    const base = row.featured_models?.length ? row.featured_models : all
    const shown = expanded.has(row.slug) ? all : base.slice(0, DEFAULT_SHOWN)
    const models = current ? [current, ...shown.filter(model => model !== current)] : shown

    sections.push({ slug: row.slug, name: row.name, models, hidden: Math.max(0, all.length - models.length), warning: row.warning })
  }

  // The bot's own provider first; the rest in the server's order.
  return sections.sort((a, b) => Number(b.slug === options.provider) - Number(a.slug === options.provider))
}

// ── skills ───────────────────────────────────────────────────────────────────────────────────────

interface SkillRow {
  name: string
  enabled: boolean
}

/**
 * One row per skill name, alphabetical. The server lists a skill once per folder it is installed in, so a name can come
 * back twice; it switches them together (the disabled list is by name, case-insensitive), so one row stands for all.
 */
export function uniqueSkills(skills: SkillRow[]): SkillRow[] {
  const seen = new Set<string>()
  const unique: SkillRow[] = []

  for (const skill of skills) {
    const key = skill.name.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      unique.push(skill)
    }
  }

  return unique.sort((a, b) => a.name.localeCompare(b.name))
}

/** `profiles.configure` takes the whole list of disabled skills, not a toggle. */
export function disabledSkills(skills: SkillRow[]): string[] {
  return uniqueSkills(skills)
    .filter(skill => !skill.enabled)
    .map(skill => skill.name)
}

/** The skills with one switched, leaving the order alone. */
export function withSkill(skills: SkillRow[], name: string, enabled: boolean): SkillRow[] {
  return skills.map(skill => (skill.name.toLowerCase() === name.toLowerCase() ? { ...skill, enabled } : skill))
}

// ── approvals ────────────────────────────────────────────────────────────────────────────────────

export type ApprovalMode = 'manual' | 'smart' | 'off'

export const APPROVAL_MODES: { value: ApprovalMode; label: string; hint: string }[] = [
  { value: 'manual', label: 'Ask me', hint: 'Every risky command waits for your Allow.' },
  { value: 'smart', label: 'Smart', hint: 'A helper model approves the clearly safe ones and asks you about the rest.' },
  { value: 'off', label: 'Never ask', hint: 'Risky commands run without asking. Only for a bot you fully trust.' },
]

/** `approvals.mode` of a bot's config; anything missing or unknown is the server's default, "manual". */
export function approvalModeOf(config: Record<string, unknown> | null | undefined): ApprovalMode {
  const approvals = config?.approvals
  const mode = approvals && typeof approvals === 'object' ? (approvals as Record<string, unknown>).mode : undefined

  return mode === 'smart' || mode === 'off' ? mode : 'manual'
}

/** The model id without its provider prefix (`z-ai/glm-5.3-flash` -> `glm-5.3-flash`), for comparing and showing. */
export const bareModel = (model: string): string => model.trim().split('/').pop() ?? model.trim()

/**
 * The model a chat is actually using, when it is not the bot's default: someone switched that chat with `/model`, or the server
 * moved it to its fallback model after the default failed (out of credit, rate limited). Null when they match or either is unknown.
 */
export function chatModelDiffers(defaultModel: string | undefined, chatModel: string | undefined): string | null {
  if (!defaultModel?.trim() || !chatModel?.trim()) {
    return null
  }

  return bareModel(defaultModel) === bareModel(chatModel) ? null : bareModel(chatModel)
}
