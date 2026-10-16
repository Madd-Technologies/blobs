/**
 * The designed store set, "Face colour" (direction B, picked on the "Blobs store listing" canvas on 2026-10-15):
 * the set opens on black with the whole cast, then each frame takes its bot's own face colour (the app's tint turned all
 * the way up), with a huge tone-on-tone face of that bot behind the phone and one piece of real UI lifted out of it.
 *
 * Plain data and pure helpers only: the Remotion compositions (bundled by webpack) and the compose command (run by Node)
 * both read this file, and its tests run under `node --test`.
 */

export type Platform = 'iphone' | 'android'
export type BotName = 'scout' | 'courier' | 'forge' | 'scribe' | 'ember'
export type BlobKind = 'round' | 'boxy' | 'cloud' | 'droplet' | 'hexagon'

/** The demo's five bots as `scripts/demo/seed.ts` draws them: a locked blobatar seed plus a pinned silhouette. */
export const CAST: Record<BotName, { seed: string; kind: BlobKind }> = {
  scout: { seed: 'scout-4zi', kind: 'cloud' },
  courier: { seed: 'courier-6j', kind: 'droplet' },
  forge: { seed: 'forge-6v', kind: 'hexagon' },
  scribe: { seed: 'scribe-20r', kind: 'boxy' },
  ember: { seed: 'ember-26f', kind: 'round' },
}

/** Left to right, as the cast stands on the first frame. */
export const CAST_ORDER: readonly BotName[] = ['scout', 'courier', 'forge', 'scribe', 'ember']

/** Every frame is laid out on a 440 x 956 grid (a 6.9" screenshot at a third of its size) and scaled to each output. */
export const DESIGN = { width: 440, height: 956 } as const

/**
 * The outputs. Apple: iPhone stills at 6.9" and at 6.3" (App Store Connect names the 6.3" set the required one), and the
 * preview. Google: 9:16 phone stills (promotion-ready) and the feature graphic.
 */
export const OUTPUTS = {
  appStoreStill: { width: 1320, height: 2868 },
  appStoreStill63: { width: 1206, height: 2622 },
  playStill: { width: 1080, height: 1920 },
  featureGraphic: { width: 1024, height: 500 },
  appStorePreview: { width: 886, height: 1920, fps: 30 },
} as const

export const BLACK = '#0A0A0A'
export const AMBER = '#FFB020'

// ── crops ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Crop extends Rect {
  /** The card's own corner radius, in the same pixels. */
  radius: number
}

export type CropName = 'needsCard' | 'approval' | 'steps' | 'deckTop' | 'tray' | 'chart' | 'details'

/** The capture sizes the crops below were measured on (the rig's iPhone 17 Pro Max and Android phone, dark pass). */
export const REFERENCE: Record<Platform, { width: number; height: number }> = {
  iphone: { width: 1320, height: 2868 },
  android: { width: 1440, height: 2560 },
}

/**
 * Where each lifted piece of UI sits in its screenshot, in the reference pixels above. These follow the app's layout, so
 * a UI change that moves a card means measuring it again here (the contact sheets `capture:compose` writes show it).
 */
export const CROPS: Record<Platform, Record<CropName, Crop>> = {
  iphone: {
    needsCard: { x: 49, y: 380, w: 1222, h: 728, radius: 52 }, // 01-home: "3 things need you"
    approval: { x: 49, y: 1946, w: 1222, h: 579, radius: 52 }, // 12-courier-approval: "Run this command?"
    steps: { x: 30, y: 1180, w: 610, h: 680, radius: 54 }, // 04-forge-steps: "On it." down to "214 passing"
    deckTop: { x: 49, y: 1225, w: 1222, h: 741, radius: 52 }, // 02-needs-you: the deck's top card
    tray: { x: 36, y: 2465, w: 1248, h: 298, radius: 64 }, // 11-room-reply: the composer with its @mention chips
    chart: { x: 49, y: 636, w: 1222, h: 551, radius: 52 }, // 07-dashboard: "Requests per day"
    details: { x: 49, y: 1154, w: 1222, h: 792, radius: 52 }, // 09-ember-awake: model, skills, tools, routines, approvals
  },
  android: {
    needsCard: { x: 56, y: 308, w: 1328, h: 854, radius: 67 },
    approval: { x: 56, y: 1521, w: 1328, h: 674, radius: 67 },
    steps: { x: 40, y: 540, w: 640, h: 790, radius: 58 },
    deckTop: { x: 56, y: 1041, w: 1328, h: 862, radius: 67 },
    tray: { x: 42, y: 2127, w: 1356, h: 350, radius: 90 },
    chart: { x: 56, y: 611, w: 1328, h: 641, radius: 67 },
    details: { x: 56, y: 1216, w: 1328, h: 922, radius: 67 },
  },
}

/** A crop in the pixels of the screenshot actually captured (the same layout at another resolution scales with its width). */
export function cropFor(platform: Platform, name: CropName, shotWidth: number): Crop {
  const crop = CROPS[platform][name]
  const k = shotWidth / REFERENCE[platform].width

  return { x: crop.x * k, y: crop.y * k, w: crop.w * k, h: crop.h * k, radius: crop.radius * k }
}

// ── colour ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mixes a #rrggbb colour toward black by `amount` (0 to 1): the giant faces are their frame's colour, a shade darker. */
export function shade(hex: string, amount: number): string {
  const channels = [1, 3, 5].map(index => Math.round(parseInt(hex.slice(index, index + 2), 16) * (1 - amount)))

  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

/** How much darker a giant face is than the paper it sits on. */
export const TONE = 0.2

// ── the stills ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type Side = 'left' | 'right' | 'center'

export interface Cutout {
  crop: CropName
  /** How much larger than in the phone the lifted piece is drawn, centred on where it sits in the phone. */
  lift: number
  /** A tilt of its own, in degrees, so it reads as lifted off the (tilted) phone. */
  rotate?: number
}

export interface StillFrame {
  /** Output file stem. */
  id: string
  /** The dark-pass screenshot it shows (capture/out/<platform>/screenshots/dark/<shot>.png). */
  shot: string
  /** Whose colour the frame takes; null is black with the whole cast. */
  bot: BotName | null
  headline: readonly string[]
  sub?: string
  /** Which way the phone tilts. */
  phone: Side
  cutout?: Cutout
}

/** The seven frames, in store order. The storyboard's "Take over its screen" waits for the rig to film Bot Screen. */
export const STILLS: readonly StillFrame[] = [
  {
    id: '01-home',
    shot: '01-home',
    bot: null,
    headline: ['Your bots,', 'one tap away.'],
    sub: 'A mobile client for Hermes Agent.',
    phone: 'center',
    cutout: { crop: 'needsCard', lift: 1.15, rotate: -2 },
  },
  {
    id: '02-approve',
    shot: '12-courier-approval',
    bot: 'courier',
    headline: ['Approve', 'from anywhere.'],
    phone: 'left',
    cutout: { crop: 'approval', lift: 1.22, rotate: 1 },
  },
  {
    id: '03-steps',
    shot: '04-forge-steps',
    bot: 'forge',
    headline: ['Watch', 'every step.'],
    phone: 'right',
    cutout: { crop: 'steps', lift: 1.5, rotate: -2 },
  },
  {
    id: '04-needs-you',
    shot: '02-needs-you',
    bot: 'scout',
    headline: ['Everything', 'that needs you,', 'in one stack.'],
    phone: 'left',
    cutout: { crop: 'deckTop', lift: 1.18, rotate: 1 },
  },
  {
    id: '05-room',
    shot: '11-room-reply',
    bot: 'scribe',
    headline: ['Put your bots', 'in one room.'],
    phone: 'right',
    cutout: { crop: 'tray', lift: 1.22, rotate: -1 },
  },
  {
    id: '06-dashboard',
    shot: '07-dashboard',
    bot: 'courier',
    headline: ['A dashboard', 'for every bot.'],
    phone: 'left',
    cutout: { crop: 'chart', lift: 1.22, rotate: 1 },
  },
  {
    id: '07-your-server',
    shot: '09-ember-awake',
    bot: 'ember',
    headline: ['No account.', 'Your server.'],
    sub: 'Blobs connects straight to your own Hermes Agent.',
    phone: 'right',
    cutout: { crop: 'details', lift: 1.16, rotate: -2 },
  },
]

/**
 * The phone on the design grid: its screen width (the height follows the capture), bezel and lean. It stays centred and
 * only tilts: a phone pushed off the edge would push its lifted card off its own original, leaving slivers of it showing.
 */
export const PHONE = {
  screenWidth: 326,
  bezel: 7,
  lean: { left: { x: 50, rotate: -3 }, right: { x: 50, rotate: 3 }, center: { x: 50, rotate: 0 } },
} as const

/** Where the phone's top edge sits: lower when the headline runs to three lines or carries a sub line. */
export function phoneTop(frame: Pick<StillFrame, 'headline' | 'sub'>): number {
  return frame.headline.length > 2 || frame.sub ? 330 : 300
}

export interface Lifted {
  crop: Crop
  /** The centre of the original in the (tilted) phone, on the design grid. */
  origin: { x: number; y: number }
  /** Design units per capture pixel. */
  scale: number
  x: number
  y: number
  width: number
  height: number
  radius: number
}

const MARGIN = { side: 20, bottom: 0, below: 24 }

/**
 * Where a frame's lifted piece of UI is drawn: centred on the spot it occupies in the (tilted) phone, `lift` times larger,
 * and kept inside the frame. It covers its own original, so the phone never shows the same card twice, and it follows
 * the app's layout on each platform without placing it by hand.
 */
export function lifted(frame: StillFrame, platform: Platform, shot: { width: number; height: number }): Lifted | null {
  const cut = frame.cutout

  if (!cut) {
    return null
  }

  const crop = cropFor(platform, cut.crop, shot.width)
  const perPixel = PHONE.screenWidth / shot.width
  const lean = PHONE.lean[frame.phone]
  const top = phoneTop(frame)
  const outer = { width: PHONE.screenWidth + 2 * PHONE.bezel, height: shot.height * perPixel + 2 * PHONE.bezel }

  // The crop's centre on the upright phone, then turned with the phone about the phone's centre.
  const px = lean.x + PHONE.bezel + (crop.x + crop.w / 2) * perPixel
  const py = top + PHONE.bezel + (crop.y + crop.h / 2) * perPixel
  const ox = lean.x + outer.width / 2
  const oy = top + outer.height / 2
  const angle = (lean.rotate * Math.PI) / 180
  const cx = ox + (px - ox) * Math.cos(angle) - (py - oy) * Math.sin(angle)
  const cy = oy + (px - ox) * Math.sin(angle) + (py - oy) * Math.cos(angle)

  const width = Math.min(crop.w * perPixel * cut.lift, DESIGN.width - 2 * MARGIN.side)
  const scale = width / crop.w
  const height = crop.h * scale
  const within = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))

  return {
    crop,
    origin: { x: cx, y: cy },
    scale,
    width,
    height,
    radius: crop.radius * scale,
    x: within(cx - width / 2, MARGIN.side, DESIGN.width - MARGIN.side - width),
    y: within(cy - height / 2, top + MARGIN.below, DESIGN.height - MARGIN.bottom - height),
  }
}

// ── the App Store preview ────────────────────────────────────────────────────────────────────────────────────────────

export interface PreviewSegment {
  id: string
  /** The rig's clip (capture/out/iphone/clips/<clip>.mp4) and the window of it to play, in seconds. */
  clip: string
  from: number
  to: number
  bot: BotName | null
  headline: readonly string[]
}

/**
 * The preview: real footage only (Apple's rule), the captions as overlays. Windows are seconds into the rig's clips and
 * follow the flows' own holds: Home then Review all, the approval then Allow, the run opening to its steps, the room's
 * question and Scout's answer, the board sliding to Done, Ember waking.
 */
export const PREVIEW: readonly PreviewSegment[] = [
  { id: 'home', clip: '01-home', from: 5.0, to: 9.5, bot: null, headline: ['Your bots,', 'one tap away.'] },
  { id: 'approve', clip: '07-courier', from: 4.0, to: 9.0, bot: 'courier', headline: ['Approve', 'from anywhere.'] },
  { id: 'steps', clip: '02-forge', from: 6.0, to: 10.5, bot: 'forge', headline: ['Watch', 'every step.'] },
  { id: 'room', clip: '06-room', from: 13.6, to: 18.6, bot: 'scribe', headline: ['Put your bots', 'in one room.'] },
  { id: 'dashboard', clip: '04-dashboard', from: 1.5, to: 6.0, bot: 'courier', headline: ['A dashboard', 'for every bot.'] },
  // No sub line here: the screen sits higher than the stills' phone, and the face peeking over it would cover one.
  { id: 'server', clip: '05-ember', from: 1.0, to: 7.0, bot: 'ember', headline: ['No account.', 'Your server.'] },
]

/** Frames two neighbouring segments overlap while one dissolves into the next. */
export const CROSSFADE = 12

export interface Timed<T> {
  segment: T
  start: number
  duration: number
}

/** Lays the segments end to end at `fps`, each overlapping the one before by the crossfade. */
export function timeline<T extends { from: number; to: number }>(segments: readonly T[], fps: number): { items: Timed<T>[]; total: number } {
  const items: Timed<T>[] = []
  let start = 0

  for (const segment of segments) {
    const duration = Math.round((segment.to - segment.from) * fps)
    items.push({ segment, start, duration })
    start += duration - CROSSFADE
  }

  const last = items.at(-1)

  return { items, total: last ? last.start + last.duration : 0 }
}
