/**
 * The walkie-talkie's talk button: hold to talk and let go to send, or tap once to keep talking hands-free and tap again to
 * send. Pure: the button feeds it presses, and it says when to start and when to send.
 */

/** A press shorter than this is a tap: it keeps the microphone on instead of sending. */
export const LOCK_TAP_MS = 300

/** `holding`: the button is down. `locked`: a tap left it on; the next tap sends. */
export type TalkHold = 'idle' | 'holding' | 'locked'

export interface TalkStep {
  hold: TalkHold
  /** `start`: start talking (the voice stops). `send`: stop and send what you said. */
  action: 'start' | 'send' | null
}

export function pressIn(hold: TalkHold): TalkStep {
  // Locked, the press that comes now is the one that sends, when it lets go.
  return hold === 'idle' ? { hold: 'holding', action: 'start' } : { hold, action: null }
}

export function pressOut(hold: TalkHold, heldMs: number, wasLocked: boolean): TalkStep {
  if (wasLocked) {
    return { hold: 'idle', action: 'send' }
  }

  if (hold !== 'holding') {
    return { hold, action: null }
  }

  return heldMs < LOCK_TAP_MS ? { hold: 'locked', action: null } : { hold: 'idle', action: 'send' }
}

/** The button's words. */
export function talkLabel(hold: TalkHold, opening: boolean): string {
  if (hold === 'locked') {
    return 'Tap to send'
  }

  if (hold === 'holding') {
    return opening ? 'Connecting…' : 'Release to send'
  }

  return 'Hold to talk'
}
