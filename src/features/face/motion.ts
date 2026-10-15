/**
 * How a bot's face moves, by what the bot is doing. Pure data, read by `BotFace`: tune the feel here. Sizes are shares of the
 * face's size, times are milliseconds. Every motion stops when the phone asks for less motion.
 */

/** `still` draws the face as it is; the others move it. Lists only move faces that are working or need you. */
export type FaceMotion = 'still' | 'idle' | 'work' | 'needs'

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
}

/** One-off reactions. */
export const REACTIONS = {
  /** You pressed the face: it squishes and blinks. */
  poke: { squish: 0.12, duration: 320 },
  /** A turn just finished: a happy squint and a little bounce. */
  done: { squint: 0.35, bounce: 0.05, duration: 900 },
}

/** The motion for a bot from what it is doing. `rest` is what an idle face does where it is shown (`still` in lists). */
export function motionFor(state: { needsYou?: boolean; working?: boolean }, rest: FaceMotion = 'idle'): FaceMotion {
  return state.needsYou ? 'needs' : state.working ? 'work' : rest
}

/** The gap before the next blink, somewhere between the spec's two bounds. */
export function nextBlink(spec: MotionSpec, random: () => number = Math.random): number | null {
  if (!spec.blink) {
    return null
  }

  const [low, high] = spec.blink

  return Math.round(low + (high - low) * random())
}
