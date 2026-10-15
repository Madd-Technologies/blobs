/**
 * Blobatar faces: deterministic soft-body avatars drawn from a string (name → face), the default for
 * new bots on Hermes Desktop. Ported from `avatar.tsx` (Hermes Desktop, MIT) with the same shape
 * strings so a bot's face matches across devices:
 *
 *   'blobatar'                follows the bot's name
 *   'blobatar:<seed>'         seed locked
 *   'blobatar:<seed>:<kind>'  seed plus one of the ten silhouettes pinned
 *   'blobatar::<kind>'        silhouette pinned, seed follows the name
 *
 * Bot names are slugs and generated seeds are base36, so ':' never appears inside a segment.
 */

import { blobatar } from 'blobatar/blob'

export const BLOB_KINDS = [
  'round',
  'organic',
  'boxy',
  'capsule',
  'nub',
  'cloud',
  'droplet',
  'hexagon',
  'sun',
  'triangle',
] as const

export type BlobKind = (typeof BLOB_KINDS)[number]

/**
 * Trait positions at the center of each silhouette band. Band thresholds are frozen per blobatar
 * major (gen2: 0.22 / 0.48 / 0.60 / 0.70 / 0.79 / 0.86 / 0.915 / 0.95 / 0.98).
 */
export const BLOB_KIND_TRAIT: Record<BlobKind, number> = {
  round: 0.11,
  organic: 0.35,
  boxy: 0.54,
  capsule: 0.65,
  nub: 0.745,
  cloud: 0.825,
  droplet: 0.8875,
  hexagon: 0.9325,
  sun: 0.965,
  triangle: 0.99,
}

export function isBlobShape(shape: string | null | undefined): boolean {
  return shape === 'blobatar' || (typeof shape === 'string' && shape.startsWith('blobatar:'))
}

function isBlobKind(value: string | undefined): value is BlobKind {
  return value !== undefined && (BLOB_KINDS as readonly string[]).includes(value)
}

export interface ParsedBlobShape {
  /** The pinned silhouette, or '' when it follows the seed. */
  kind: BlobKind | ''
  /** The seed actually rendered: the pinned one, else the bot's name. */
  seed: string
  /** The pinned seed alone, '' when the face follows the name. */
  seedPart: string
}

export function parseBlobShape(shape: string | null | undefined, name: string | undefined): ParsedBlobShape {
  const parts = typeof shape === 'string' ? shape.split(':') : []
  const seedPart = parts[1] || ''
  const kind = parts[2]

  return {
    seed: seedPart || name || 'agent',
    seedPart,
    kind: isBlobKind(kind) ? kind : '',
  }
}

export function blobShapeString(seedPart: string, kind: BlobKind | ''): string {
  if (kind) {
    return `blobatar:${seedPart}:${kind}`
  }

  return seedPart ? `blobatar:${seedPart}` : 'blobatar'
}

/** SVG markup for a blob face (its own palette and eyes included), or null if rendering fails. */
export function blobSvg(shape: string | null | undefined, name: string, size: number): string | null {
  const { seed, kind } = parseBlobShape(shape, name)

  try {
    return blobatar(seed, kind ? { size, traits: { shape: BLOB_KIND_TRAIT[kind] } } : { size })
  } catch {
    return null
  }
}

export interface BlobParts {
  /** The face without its eyes, as an SVG document. */
  body: string
  /** Only the eyes, as an SVG document of the same size, to draw over the body (and move on their own). */
  eyes: string
  /** Where the eyes sit, as a share of the face's height (their centre line). */
  eyeLine: number
}

/**
 * Splits a blobatar into its body and its eyes, so the eyes can blink and glance on a layer of their own. A blobatar is an
 * `<svg>` holding two groups, the body and then the eyes; anything else (a future library shape) gives null and is drawn whole.
 */
export function splitBlob(xml: string): BlobParts | null {
  const open = /^<svg[^>]*>/.exec(xml)?.[0]
  const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(open ?? '')
  const groups = xml.match(/<g\b[^>]*>[\s\S]*?<\/g>/g)

  if (!open || !viewBox || groups?.length !== 2) {
    return null
  }

  const [bodyGroup, eyeGroup] = groups as [string, string]
  // Every number pair in the eye paths is a point (and round eyes give their centre): their vertical extent gives the eye line.
  const number = /-?\d*\.?\d+/g
  const pathYs = [...eyeGroup.matchAll(/\bd="([^"]*)"/g)].flatMap(match => (match[1]?.match(number) ?? []).map(Number).filter((_, index) => index % 2 === 1))
  const centreYs = [...eyeGroup.matchAll(/\bcy="([^"]*)"/g)].map(match => Number(match[1]))
  const ys = [...pathYs, ...centreYs].filter(Number.isFinite)

  if (!ys.length) {
    return null
  }

  const height = Number(viewBox[2])

  return {
    body: `${open}${bodyGroup}</svg>`,
    eyes: `${open}${eyeGroup}</svg>`,
    eyeLine: (Math.min(...ys) + Math.max(...ys)) / 2 / height,
  }
}
