/**
 * Bot face geometry, ported from Hermes Desktop (`apps/desktop/src/plugins/hermes-bots/avatar.tsx`,
 * MIT) so a bot looks identical on phone and desktop. Pure: no React, no React Native.
 *
 * `buildFace` returns a plain description (paths, eyes, highlights); `BotFace` just draws it.
 */

/** One point in the 40x40 face box. */
export type FacePoint = [number, number]

export type FaceMood = 'idle' | 'work' | 'off'

// ── outline sampling ─────────────────────────────────────────────────────────────────────────────

function cubicAt(p0: FacePoint, p1: FacePoint, p2: FacePoint, p3: FacePoint, t: number): FacePoint {
  const u = 1 - t

  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ]
}

/** Same outline as the old GitHub drop path, so it stays a fat water drop. */
function sampleDropRing(steps: number): FacePoint[] {
  const pts: FacePoint[] = []
  const n = Math.max(8, Math.floor(steps / 3))

  for (let i = 0; i < n; i++) {
    pts.push(cubicAt([20, 3], [20, 3], [6, 20], [6, 27], i / n))
  }

  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI
    pts.push([20 - 14 * Math.cos(t), 27 + 13.5 * Math.sin(t)])
  }

  for (let i = 1; i <= n; i++) {
    pts.push(cubicAt([34, 27], [34, 20], [20, 3], [20, 3], i / n))
  }

  return pts
}

/** A center-parameterized elliptical arc, as `sampleArc` walks it. */
interface FaceArc {
  cx: number
  cy: number
  dtheta: number
  rx: number
  ry: number
  theta1: number
}

function svgArc(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  fa: number,
  fs: number,
  x2: number,
  y2: number,
): FaceArc {
  let rx = rxIn
  let ry = ryIn
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  let rx2 = rx * rx
  let ry2 = ry * ry
  const lam = (dx * dx) / rx2 + (dy * dy) / ry2

  if (lam > 1) {
    const s = Math.sqrt(lam)
    rx *= s
    ry *= s
    rx2 = rx * rx
    ry2 = ry * ry
  }

  const num = rx2 * ry2 - rx2 * dy * dy - ry2 * dx * dx
  const den = rx2 * dy * dy + ry2 * dx * dx
  let sq = Math.sqrt(Math.max(0, num / den))

  if (fa === fs) {
    sq = -sq
  }

  const cx = sq * ((rx * dy) / ry) + (x1 + x2) / 2
  const cy = sq * ((-ry * dx) / rx) + (y1 + y2) / 2

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const n = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1
    let a = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n)))

    if (ux * vy - uy * vx < 0) {
      a = -a
    }

    return a
  }

  const theta1 = ang(1, 0, (x1 - cx) / rx, (y1 - cy) / ry)
  let dtheta = ang((x1 - cx) / rx, (y1 - cy) / ry, (x2 - cx) / rx, (y2 - cy) / ry)

  if (!fs && dtheta > 0) {
    dtheta -= Math.PI * 2
  }

  if (fs && dtheta < 0) {
    dtheta += Math.PI * 2
  }

  return { cx, cy, rx, ry, theta1, dtheta }
}

function sampleArc(arc: FaceArc, n: number): FacePoint[] {
  const pts: FacePoint[] = []

  for (let i = 0; i < n; i++) {
    const th = arc.theta1 + arc.dtheta * (i / n)
    pts.push([arc.cx + arc.rx * Math.cos(th), arc.cy + arc.ry * Math.sin(th)])
  }

  return pts
}

/** Same outline as the old GitHub cloud path: three puffs and a flat floor. */
function sampleCloudRing(steps: number): FacePoint[] {
  const a1 = svgArc(11, 32, 7.5, 7.5, 0, 1, 10, 17.1)
  const a2 = svgArc(10, 17.1, 9.5, 9.5, 0, 1, 29, 12.5)
  const a3 = svgArc(29, 12.5, 7, 7, 0, 1, 30, 32)
  const len1 = Math.abs(a1.dtheta) * a1.rx
  const len2 = Math.abs(a2.dtheta) * a2.rx
  const len3 = Math.abs(a3.dtheta) * a3.rx
  const len4 = 19
  const total = len1 + len2 + len3 + len4
  const n = Math.max(64, steps)
  const n1 = Math.max(8, Math.round((n * len1) / total))
  const n2 = Math.max(10, Math.round((n * len2) / total))
  const n3 = Math.max(10, Math.round((n * len3) / total))
  const n4 = Math.max(4, n - n1 - n2 - n3)
  const pts: FacePoint[] = []
  pts.push(...sampleArc(a1, n1))
  pts.push(...sampleArc(a2, n2))
  pts.push(...sampleArc(a3, n3))

  for (let i = 0; i < n4; i++) {
    pts.push([30 + (11 - 30) * (i / n4), 32])
  }

  return pts
}

/** Outline of a face in a 40x40 box, sampled from formulas. */
export function sampleFaceRing(shape: string | null | undefined, steps = 52): FacePoint[] {
  const kind = (shape || '').startsWith('sigil-') ? 'circle' : shape

  if (kind === 'drop' || kind === 'teardrop') {
    return sampleDropRing(steps)
  }

  if (kind === 'cloud') {
    return sampleCloudRing(steps)
  }

  const pts: FacePoint[] = []

  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2 - Math.PI / 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    let r = 16

    if (kind === 'circle') {
      r = 16.2
    } else if (kind === 'blob') {
      r = 16 + 1.7 * Math.sin(3 * a) + 0.7 * Math.cos(5 * a)
    } else if (kind === 'squircle') {
      const p = 5
      const d = Math.pow(Math.abs(c) ** p + Math.abs(s) ** p, 1 / p) || 1
      r = 16.2 / d
    } else if (kind === 'pill') {
      const d = Math.pow(Math.abs(c) ** 8 + Math.abs(s / 0.72) ** 8, 1 / 8) || 1
      r = 16 / d
    } else if (kind === 'triangle' || kind === 'tetrahedron' || kind === 'wedge') {
      const u = (a + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)
      const sector = (u / ((Math.PI * 2) / 3)) % 1
      r = 13.5 / Math.max(0.42, Math.cos((sector - 0.5) * 1.9))
    } else if (kind === 'hexagon' || kind === 'hex' || kind === 'icosahedron' || kind === 'dodecahedron') {
      const seg = Math.PI / 3
      const hex = Math.cos(seg / 2) / Math.cos(a - seg * Math.round(a / seg))
      r = 16.2 * hex
    } else if (kind === 'cube' || kind === 'octahedron') {
      const p = 3.1
      const d = Math.pow(Math.abs(c) ** p + Math.abs(s) ** p, 1 / p) || 1
      r = 16 / d
    } else if (kind === 'pebble') {
      pts.push([20 + 16.4 * (1.04 - 0.14 * Math.cos(2 * a)) * c, 20 + 15.2 * (1.06 + 0.08 * Math.sin(2 * a)) * s])
      continue
    } else {
      r = 16.2
    }

    pts.push([20 + r * c, 20 + r * s])
  }

  return pts
}

export function ringToPath(pts: FacePoint[]): string {
  let d = ''

  for (const [x, y] of pts) {
    d += `${d ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`
  }

  return d ? `${d}Z` : ''
}

// ── legacy sigils ────────────────────────────────────────────────────────────────────────────────

/** xorshift PRNG seeded from a string, stable across sessions and platforms. */
function sigilRng(text: string): () => number {
  let h = 2166136261

  for (const ch of text) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }

  let state = h >>> 0 || 88675123

  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0

    return state / 4294967296
  }
}

export interface SigilGeometry {
  /** The optional diamond ring, as an SVG path. */
  ring: string | null
  /** Every stroke joined into one SVG path. */
  strokes: string
}

/** Angular hermetic sigil: strokes on the left half of a 5-column grid, mirrored right. */
export function sigilGeometry(name: string, seed: number): SigilGeometry {
  const rng = sigilRng(`${name}::${seed}`)
  const gx = (i: number) => 6 + i * 7
  const gy = (j: number) => 8 + j * 6
  const strokes: string[] = []
  const segments = 4 + Math.floor(rng() * 3)

  for (let k = 0; k < segments; k++) {
    const x1 = Math.floor(rng() * 3)
    const y1 = Math.floor(rng() * 5)
    const x2 = Math.min(2, Math.max(0, x1 + (rng() > 0.5 ? 1 : -1)))
    const y2 = Math.min(4, Math.max(0, y1 + Math.floor(rng() * 3) - 1))
    strokes.push(`M${gx(x1)} ${gy(y1)} L${gx(x2)} ${gy(y2)}`)
    strokes.push(`M${gx(4 - x1)} ${gy(y1)} L${gx(4 - x2)} ${gy(y2)}`)

    if (rng() > 0.6) {
      strokes.push(`M${gx(x2)} ${gy(y2)} L${gx(4 - x2)} ${gy(y2)}`)
    }
  }

  strokes.push(`M20 ${gy(0)} L20 ${gy(4)}`)
  const ring = rng() > 0.45 ? 'M20 4 L36 20 L20 36 L4 20 Z' : null

  return { strokes: strokes.join(' '), ring }
}

// ── color helpers ────────────────────────────────────────────────────────────────────────────────

/** Parses `#rgb`, `#rrggbb`, `rgb()` and `hsl()` (comma or space separated) into 0-255 channels. */
export function parseColor(input: string): [number, number, number] | null {
  const value = input.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)

  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    const n = parseInt(h, 16)

    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  const fn = /^(rgb|hsl)a?\(([^)]+)\)$/.exec(value)

  if (!fn?.[2]) {
    return null
  }

  const parts = fn[2].split(/[\s,/]+/).filter(Boolean)
  const nums = parts.slice(0, 3).map(p => parseFloat(p))

  if (nums.length < 3 || nums.some(n => Number.isNaN(n))) {
    return null
  }

  const [a = 0, b = 0, c = 0] = nums

  if (fn[1] === 'rgb') {
    return [a, b, c].map(n => Math.max(0, Math.min(255, n))) as [number, number, number]
  }

  const h = (((a % 360) + 360) % 360) / 360
  const s = Math.max(0, Math.min(100, b)) / 100
  const l = Math.max(0, Math.min(100, c)) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (tIn: number) => {
    const t = (tIn + 1) % 1
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p

    return Math.round(v * 255)
  }

  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

/**
 * Perceptual luminance test, so eyes flip light on dark bodies. Unlike Desktop (which only parses
 * `#rrggbb`) this also understands `hsl()` and `rgb()`, which is what bots' derived colors use.
 */
export function isDarkColor(color: string): boolean {
  const rgb = parseColor(color)

  if (!rgb) {
    return false
  }

  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 110
}

// ── face description ─────────────────────────────────────────────────────────────────────────────

export interface FaceEye {
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface FaceHighlight {
  cx: number
  cy: number
  r: number
}

export interface FaceDot {
  cx: number
  cy: number
  r: number
  opacity: number
}

interface FaceBase {
  viewBox: string
}

export interface RingFace extends FaceBase {
  type: 'ring'
  /** Body outline. Fill it with the bot color. */
  body: string
  eyes: [FaceEye, FaceEye]
  highlights: [FaceHighlight, FaceHighlight]
  /** Eye color; light on dark bodies. */
  eyeFill: string
  highlightFill: string
  /** Path of two short lines: the eyes for the `off` mood (and a blink). */
  shut: string
  /** Pulsing "working" dots below the body; empty unless the mood is `work`. */
  dots: FaceDot[]
}

export interface SigilFace extends FaceBase {
  type: 'sigil'
  strokes: string
  ring: string | null
  eyes: [{ cx: number; cy: number; r: number }, { cx: number; cy: number; r: number }]
}

export type Face = RingFace | SigilFace

const CLOUD_BODY = 'M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z'

/**
 * Everything needed to draw a bot's classic face. Moods: `idle`, `work` (taller eyes, dots), `off`
 * (eyes become lines). `shape` is free-form: a classic shape, `blob`, a platonic solid or `sigil-N`.
 */
export function buildFace(shape: string, color: string, name: string, mood: FaceMood = 'idle'): Face {
  if (shape.startsWith('sigil-')) {
    const { strokes, ring } = sigilGeometry(name, Number(shape.slice(6)) || 0)

    return {
      type: 'sigil',
      viewBox: '0 0 40 40',
      strokes,
      ring,
      eyes: [
        { cx: 16, cy: 14, r: 2.4 },
        { cx: 24, cy: 14, r: 2.4 },
      ],
    }
  }

  const working = mood === 'work'
  const dark = isDarkColor(color)
  const eyeY = shape === 'cloud' ? 22 : 17.2
  const ry = working ? 2.6 : 2.3

  return {
    type: 'ring',
    viewBox: '0 0 40 44',
    body: shape === 'cloud' ? CLOUD_BODY : ringToPath(sampleFaceRing(shape)),
    eyes: [
      { cx: 15.4, cy: eyeY, rx: 2.2, ry },
      { cx: 24.6, cy: eyeY, rx: 2.2, ry },
    ],
    highlights: [
      { cx: 14.8, cy: eyeY - 0.7, r: 0.65 },
      { cx: 24, cy: eyeY - 0.7, r: 0.65 },
    ],
    eyeFill: dark ? 'rgba(232,220,195,0.95)' : 'rgba(0,0,0,0.85)',
    highlightFill: dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)',
    shut: `M12.8 ${eyeY} L18 ${eyeY} M22 ${eyeY} L27.2 ${eyeY}`,
    dots: working
      ? [16.4, 20, 23.6].map(cx => ({ cx, cy: 41.2, r: 1.15, opacity: 0.2 }))
      : [],
  }
}
