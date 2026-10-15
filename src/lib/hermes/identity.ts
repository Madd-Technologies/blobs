/**
 * Bot identity: the name, color and shape a bot is shown with. Ported from Hermes Desktop
 * (`lib/profile-color.ts`, `plugins/hermes-bots/{avatar,labels}.ts(x)`, MIT) so a bot reads the same
 * on phone and desktop. Pure: no React Native imports.
 */

// ── types ────────────────────────────────────────────────────────────────────────────────────────

/** The `ui_meta['hermes-bots']` object stored on a profile. */
export interface BotMeta {
  color?: string
  /** Set when the user customized the avatar, so defaults stop applying. */
  custom?: boolean
  description?: string
  groups?: string[]
  hidden?: boolean
  /** Data URL. Photos travel separately via `profiles.get_asset`. */
  image?: string | null
  imageKind?: 'photo' | 'shape'
  group?: string | null
  pinned?: boolean
  shape?: string
  title?: string
  /** Creation timestamp in ms. */
  created?: number
}

/** The slice of a `profiles.list` row that identity needs. */
export interface BotRowIdentity {
  name: string
  title?: string | null
  display_name?: string | null
}

export type AvatarShape = 'circle' | 'squircle' | 'pill' | 'triangle' | 'hexagon' | 'cloud' | 'drop'

export interface Appearance {
  /** Classic shape, `blob`, or a free-form string such as `blobatar:seed:kind`. */
  shape: string
  /** CSS color, or null when the bot has none (the face then uses {@link avatarColor}). */
  color: string | null
  image: string | null
}

// ── color ────────────────────────────────────────────────────────────────────────────────────────

const TAG_SATURATION = 68
const TAG_LIGHTNESS = 58

/** The friendly violet the primary profile wears, and the last resort for a nameless draft. */
export const PRIMARY_AVATAR_COLOR = '#8b5cf6'

function hashString(value: string): number {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash
}

/** Deterministic `hsl()` for a named profile; null for `default` or empty (rendered neutral). */
export function profileColor(name: string | null | undefined): string | null {
  const key = (name ?? '').trim()

  if (!key || key === 'default') {
    return null
  }

  return `hsl(${hashString(key) % 360} ${TAG_SATURATION}% ${TAG_LIGHTNESS}%)`
}

/** Twelve evenly spaced hues at the same saturation/lightness as the derived palette. */
export const PROFILE_SWATCHES: readonly string[] = Array.from(
  { length: 12 },
  (_, index) => `hsl(${index * 30} ${TAG_SATURATION}% ${TAG_LIGHTNESS}%)`,
)

/** A picked color wins; otherwise the name's hue, then the primary violet. */
export function avatarColor(color: string | null | undefined, name: string): string {
  return color || profileColor(name) || PRIMARY_AVATAR_COLOR
}

// ── shape ────────────────────────────────────────────────────────────────────────────────────────

export const AVATAR_SHAPES: readonly AvatarShape[] = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop']

/** Shapes the picker offers, in Desktop's order. */
export const AVATAR_PICKER_SHAPES = ['circle', 'blob', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'] as const

export function defaultShapeFor(name: string): AvatarShape {
  let hash = 0

  // Iterates code points but hashes only the first UTF-16 unit of each, exactly like Desktop.
  for (const ch of name) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  }

  return AVATAR_SHAPES[hash % AVATAR_SHAPES.length] ?? 'circle'
}

// ── name ─────────────────────────────────────────────────────────────────────────────────────────

/** The name a bot row shows: ui_meta title, then the profile's display name, then a tidy slug. */
export function displayName(bot: BotRowIdentity, meta?: BotMeta | null): string {
  const title = meta?.title?.trim()

  if (title) {
    return title
  }

  if (typeof bot.display_name === 'string' && bot.display_name.trim()) {
    return bot.display_name.trim()
  }

  // The primary profile is literally named "default"; present it as the agent it is.
  if (bot.name.trim().toLowerCase() === 'default' && !bot.title) {
    return 'Hermes'
  }

  const raw = (bot.title || bot.name || '').replace(/[-_]+/g, ' ').trim()

  return raw.replace(/\b\w/g, ch => ch.toUpperCase())
}

// ── appearance ───────────────────────────────────────────────────────────────────────────────────

/** Shape, color and image a bot is drawn with, applying Desktop's rule for the primary profile. */
export function botAppearance(name: string, meta: BotMeta | null | undefined): Appearance {
  const isPrimary = name.trim().toLowerCase() === 'default'

  // The primary gets a fixed friendly violet squircle unless the user explicitly customized it.
  if (isPrimary && !meta?.custom) {
    return { shape: 'squircle', color: PRIMARY_AVATAR_COLOR, image: meta?.image || null }
  }

  return {
    shape: meta?.shape || defaultShapeFor(name),
    color: meta?.color || profileColor(name),
    image: meta?.image || null,
  }
}
