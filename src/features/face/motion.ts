/**
 * How a bot's face moves, by what the bot is doing. Pure data, read by `BotFace`: tune the feel here. Sizes are shares of the
 * face's size, times are milliseconds. Every motion stops when the phone asks for less motion.
 */

/**
 * `still` draws the face as it is; the others move it. Lists only move faces that are working or need you. `doze` is the
 * one exception that changes a face at rest: its eyes are shut, and nothing moves until it is tapped awake.
 */
export type FaceMotion = 'still' | 'idle' | 'work' | 'needs' | 'doze'

/** A bot that has done nothing for this long dozes (seconds). */
export const DOZE_AFTER_S = 6 * 60 * 60

export interface MotionSpec {
  /** Blink after a random gap between these two (ms); null never blinks. */
  blink: [number, number] | null
  /** The eyes look left, then right, by this share of the face's width, once per period. */
  glance: { amount: number; period: number } | null
  /** The face breathes: rises by this share of its size and stretches a little, once per period. */
  bob: { amount: number; period: number } | null
  /** A small hop of this share of its size, then a pause of `every` ms before the next. */
  hop: { amount: number; every: number } | null
  /** Eye height, 1 as drawn: taller eyes look alert. */
  eyes: number
}

export const MOTIONS: Record<Exclude<FaceMotion, 'still'>, MotionSpec> = {
  /** Resting: an occasional blink, nothing else. */
  idle: { blink: [3500, 6500], glance: null, bob: null, hop: null, eyes: 1 },
  /** Working: eyes glancing side to side, a slow breathing bob, blinks now and then. */
  work: { blink: [2600, 5200], glance: { amount: 0.04, period: 2600 }, bob: { amount: 0.03, period: 1800 }, hop: null, eyes: 1.08 },
  /** Needs you: eyes wide, a small hop every few seconds to catch your eye. */
  needs: { blink: [4000, 7000], glance: null, bob: null, hop: { amount: 0.1, every: 2600 }, eyes: 1.22 },
  /** Dozing: eyes shut, perfectly still, so a list of sleepy bots stays quiet. */
  doze: { blink: null, glance: null, bob: null, hop: null, eyes: 0.12 },
}

/** One-off reactions. */
export const REACTIONS = {
  /** You pressed the face: it squishes and blinks. */
  poke: { squish: 0.12, duration: 320 },
  /** A turn just finished: a happy squint and a little bounce. */
  done: { squint: 0.35, bounce: 0.05, duration: 900 },
  /** You tapped a dozing face: it opens its eyes and stays awake this long (ms) before nodding off again. */
  wake: { duration: 60_000 },
}

/** The motion for a bot from what it is doing. `rest` is what an idle face does where it is shown (`still` in lists). */
export function motionFor(state: { needsYou?: boolean; working?: boolean; dozing?: boolean }, rest: FaceMotion = 'idle'): FaceMotion {
  return state.needsYou ? 'needs' : state.working ? 'work' : state.dozing ? 'doze' : rest
}

/** A bot dozes when its last activity (epoch seconds) is long enough ago. A bot with no activity yet (0) stays awake. */
export function isDozing(lastActive: number | undefined, nowS: number = Date.now() / 1000): boolean {
  return !!lastActive && lastActive > 0 && nowS - lastActive >= DOZE_AFTER_S
}

/** The gap before the next blink, somewhere between the spec's two bounds. */
export function nextBlink(spec: MotionSpec, random: () => number = Math.random): number | null {
  if (!spec.blink) {
    return null
  }

  const [low, high] = spec.blink

  return Math.round(low + (high - low) * random())
}
