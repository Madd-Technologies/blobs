/**
 * Keys for driving a bot's screen from a phone: X keysyms, the sticky modifiers of the extra-keys bar, and
 * turning text typed on the phone's keyboard into key events. Pure.
 *
 * RFB sends X keysyms. For Latin-1 text the keysym is the character's code point; for everything else it is
 * `0x01000000 + code point`; the editing and cursor keys have their own values.
 */

export const KEY = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ControlL: 0xffe3,
  AltL: 0xffe9,
  SuperL: 0xffeb,
  ShiftL: 0xffe1,
} as const

export type Modifier = 'ctrl' | 'alt' | 'super'

export const MODIFIER_KEYSYM: Record<Modifier, number> = { ctrl: KEY.ControlL, alt: KEY.AltL, super: KEY.SuperL }

/** The keysym for one typed character (its first code point), or null for nothing to send. */
export function keysymForChar(char: string): number | null {
  const code = char.codePointAt(0)

  if (code === undefined) {
    return null
  }

  if (code === 0x0a || code === 0x0d) {
    return KEY.Return
  }

  if (code === 0x09) {
    return KEY.Tab
  }

  if (code < 0x20) {
    return null
  }

  return code <= 0x7e || (code >= 0xa0 && code <= 0xff) ? code : 0x01000000 + code
}

export interface KeyEvent {
  keysym: number
  /** Omitted for a press and release together. */
  down?: boolean
}

/** One key with the held modifiers: modifiers down, the key pressed, modifiers up (in reverse). */
export function chord(modifiers: Modifier[], keysym: number): KeyEvent[] {
  const held = modifiers.map(modifier => MODIFIER_KEYSYM[modifier])

  return [...held.map(held => ({ keysym: held, down: true })), { keysym }, ...[...held].reverse().map(held => ({ keysym: held, down: false }))]
}

/**
 * What the phone's keyboard did to a text field: the characters after the common start of `previous` and
 * `next` are what was typed, and the rest of `previous` is what was deleted.
 */
export function diffTyped(previous: string, next: string): { backspaces: number; typed: string } {
  const before = Array.from(previous)
  const after = Array.from(next)
  let common = 0

  while (common < before.length && common < after.length && before[common] === after[common]) {
    common++
  }

  return { backspaces: before.length - common, typed: after.slice(common).join('') }
}

/** The key events for text typed on the phone, with the modifiers currently held applied to each character. */
export function eventsForTyped(typed: string, modifiers: Modifier[]): KeyEvent[] {
  const events: KeyEvent[] = []

  for (const char of typed) {
    const keysym = keysymForChar(char)

    if (keysym !== null) {
      events.push(...chord(modifiers, keysym))
    }
  }

  return events
}

/**
 * The key events for one change of the phone's hidden text field, from what it held to what it holds now:
 * a backspace for each character removed, then the characters typed (with any held modifiers). The field
 * keeps what was typed, so every change must be read against the last, never as new text on its own.
 */
export function eventsForChange(previous: string, next: string, modifiers: Modifier[]): { events: KeyEvent[]; typedAny: boolean } {
  const { backspaces, typed } = diffTyped(previous, next)
  const events: KeyEvent[] = Array.from({ length: backspaces }, () => ({ keysym: KEY.Backspace }))
  events.push(...eventsForTyped(typed, modifiers))

  return { events, typedAny: typed.length > 0 }
}
