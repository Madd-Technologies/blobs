/**
 * The five faces of the Blobs brand: the website's crowd (`scripts/build-site.mjs`), named like the demo's bots. They star
 * in the cold-boot splash and the tutorial. Each locks its hue, so it is drawn here rather than from a profile. Pure.
 */

import { blobatar } from 'blobatar/blob'

import { BLOB_KIND_TRAIT, type BlobKind } from '../../lib/hermes/blob.ts'

export type CrowdId = 'scout' | 'courier' | 'forge' | 'scribe' | 'ember'

export interface CrowdFace {
  id: CrowdId
  name: string
  seed: string
  kind: BlobKind
  hue: number
}

/** Same seeds, silhouettes and hues as the website. Courier is the brand mark (the favicon, the splash). */
export const CROWD: Record<CrowdId, CrowdFace> = {
  scout: { id: 'scout', name: 'Scout', seed: 'blobs-1', kind: 'cloud', hue: 175 },
  courier: { id: 'courier', name: 'Courier', seed: 'blobs-2', kind: 'droplet', hue: 215 },
  forge: { id: 'forge', name: 'Forge', seed: 'blobs-3', kind: 'hexagon', hue: 20 },
  scribe: { id: 'scribe', name: 'Scribe', seed: 'blobs-4', kind: 'boxy', hue: 330 },
  ember: { id: 'ember', name: 'Ember', seed: 'blobs-5', kind: 'round', hue: 265 },
}

/** Left to right, as the website lines them up. */
export const CROWD_ORDER: CrowdId[] = ['scout', 'courier', 'forge', 'scribe', 'ember']

/** The face as SVG markup, `size` wide: the website's exact drawing (Courier at 100 is the favicon). */
export function crowdSvg(id: CrowdId, size: number): string {
  const face = CROWD[id]

  return blobatar(face.seed, { hue: face.hue, tone: 0.5, size, traits: { shape: BLOB_KIND_TRAIT[face.kind] } })
}

/** The body's color, which tints the paper of that face's cards. */
export function crowdColor(id: CrowdId): string {
  return /<g\b[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/.exec(crowdSvg(id, 40))?.[1] ?? '#8E8E93'
}
