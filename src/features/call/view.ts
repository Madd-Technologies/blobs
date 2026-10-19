/**
 * The words the call screen and the chat's call bar show for a call. Pure.
 */

import type { CallSnapshot } from './engine.ts'

/** What leads the status line: the spinner while something is on its way, the amber dot while a card waits for you. */
export type StatusMark = 'spinner' | 'needs' | null

export interface CallStatus {
  text: string
  mark: StatusMark
}

/** One quiet line for where the call is. `waiting`: an approval or question in the chat waits for a tap. */
export function callStatus(call: CallSnapshot, botName: string, waiting: boolean): CallStatus {
  if (call.phase === 'connecting') {
    return { text: `Calling ${botName}…`, mark: 'spinner' }
  }

  if (call.phase === 'ended') {
    return { text: call.note ?? 'Call ended', mark: null }
  }

  if (waiting) {
    return { text: 'Waiting for you', mark: 'needs' }
  }

  if (call.tasks > 0) {
    return { text: call.tasks === 1 ? `${botName} is on it` : `${botName} is on ${call.tasks} things`, mark: 'spinner' }
  }

  return { text: call.speaking === 'voice' ? 'Speaking' : call.muted ? 'Muted' : 'Listening', mark: null }
}

/** About three lines of the call screen's 22 pt caption. */
export const CAPTION_CHARS = 96

/**
 * The end of a caption that is too long for its three lines: the newest words are the ones being said, so the start goes, cut
 * at a word, behind an ellipsis.
 */
export function captionTail(text: string, max: number = CAPTION_CHARS): string {
  const said = text.trim().replace(/\s+/g, ' ')

  if (said.length <= max) {
    return said
  }

  const start = said.length - max
  const end = said.slice(start)

  // Already at the start of a word, or the first word is cut and goes.
  if (said[start - 1] === ' ') {
    return `…${end}`
  }

  const space = end.indexOf(' ')

  return `…${space >= 0 && space < max / 3 ? end.slice(space + 1) : end}`
}
