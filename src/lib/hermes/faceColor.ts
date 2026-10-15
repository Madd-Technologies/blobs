import { blobSvg, isBlobShape } from './blob.ts'
import { avatarColor, botAppearance, type BotMeta } from './identity.ts'

const blobColors = new Map<string, string | null>()

/** The fill of a blob face's body (blobatars bring their own palette), or null when it cannot be drawn. */
export function blobColor(shape: string, name: string): string | null {
  const key = `${shape}|${name}`

  if (!blobColors.has(key)) {
    const svg = blobSvg(shape, name, 40)
    blobColors.set(key, (svg && /<g\b[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/.exec(svg)?.[1]) || null)
  }

  return blobColors.get(key) ?? null
}

/**
 * The color a bot's face is drawn in, which tints its paper on its own screens (Card Stock): a blob face's body color, else
 * the picked or name-derived color the classic shapes use.
 */
export function faceColor(name: string, meta: BotMeta | null | undefined): string {
  const appearance = botAppearance(name, meta)
  const blob = isBlobShape(appearance.shape) && !appearance.image ? blobColor(appearance.shape, name) : null

  return blob ?? avatarColor(appearance.color, name)
}
