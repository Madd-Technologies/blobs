import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { chord, diffTyped, eventsForChange, eventsForTyped, KEY, keysymForChar } from './keys.ts'

describe('keysymForChar', () => {
  it('Latin-1 characters are their code point', () => {
    assert.equal(keysymForChar('a'), 0x61)
    assert.equal(keysymForChar('Z'), 0x5a)
    assert.equal(keysymForChar(' '), 0x20)
    assert.equal(keysymForChar('~'), 0x7e)
    assert.equal(keysymForChar('é'), 0xe9)
  })

  it('anything beyond Latin-1 is 0x01000000 + the code point', () => {
    assert.equal(keysymForChar('€'), 0x01000000 + 0x20ac)
    assert.equal(keysymForChar('😀'), 0x01000000 + 0x1f600)
    assert.equal(keysymForChar('日'), 0x01000000 + 0x65e5)
  })

  it('return and tab are their keys', () => {
    assert.equal(keysymForChar('\n'), KEY.Return)
    assert.equal(keysymForChar('\r'), KEY.Return)
    assert.equal(keysymForChar('\t'), KEY.Tab)
  })

  it('other control characters and nothing at all send nothing', () => {
    assert.equal(keysymForChar('\u0007'), null)
    assert.equal(keysymForChar(''), null)
  })
})

describe('chord', () => {
  it('a plain key is just the key', () => {
    assert.deepEqual(chord([], 0x61), [{ keysym: 0x61 }])
  })

  it('modifiers go down first and come up after, in reverse', () => {
    assert.deepEqual(chord(['ctrl', 'alt'], 0x63), [
      { keysym: KEY.ControlL, down: true },
      { keysym: KEY.AltL, down: true },
      { keysym: 0x63 },
      { keysym: KEY.AltL, down: false },
      { keysym: KEY.ControlL, down: false },
    ])
  })
})

describe('diffTyped', () => {
  it('appended text is typed', () => {
    assert.deepEqual(diffTyped('ab', 'abc'), { backspaces: 0, typed: 'c' })
    assert.deepEqual(diffTyped('', 'hi'), { backspaces: 0, typed: 'hi' })
  })

  it('removed text is backspaces', () => {
    assert.deepEqual(diffTyped('abc', 'ab'), { backspaces: 1, typed: '' })
    assert.deepEqual(diffTyped('abc', ''), { backspaces: 3, typed: '' })
  })

  it('a replacement (autocorrect) is backspaces then the new text', () => {
    assert.deepEqual(diffTyped('teh', 'the'), { backspaces: 2, typed: 'he' })
  })

  it('counts emoji and other astral characters as one', () => {
    assert.deepEqual(diffTyped('a😀', 'a'), { backspaces: 1, typed: '' })
    assert.deepEqual(diffTyped('a', 'a😀'), { backspaces: 0, typed: '😀' })
  })

  it('no change is nothing', () => {
    assert.deepEqual(diffTyped('same', 'same'), { backspaces: 0, typed: '' })
  })
})

describe('eventsForTyped', () => {
  it('each character becomes a key', () => {
    assert.deepEqual(eventsForTyped('hi', []), [{ keysym: 0x68 }, { keysym: 0x69 }])
  })

  it('held modifiers wrap every character (ctrl then c is ctrl+c)', () => {
    assert.deepEqual(eventsForTyped('c', ['ctrl']), [{ keysym: KEY.ControlL, down: true }, { keysym: 0x63 }, { keysym: KEY.ControlL, down: false }])
  })

  it('characters with no key are skipped', () => {
    assert.deepEqual(eventsForTyped('a\u0007b', []), [{ keysym: 0x61 }, { keysym: 0x62 }])
  })
})

describe('eventsForChange', () => {
  it('typing one more character sends only that character, not everything typed so far', () => {
    // The bug this guards against: typing "echo" sent e, ec, ech, echo.
    let text = ''
    const sent: number[] = []

    for (const next of ['e', 'ec', 'ech', 'echo']) {
      sent.push(...eventsForChange(text, next, []).events.map(event => event.keysym))
      text = next
    }

    assert.deepEqual(sent, [0x65, 0x63, 0x68, 0x6f])
  })

  it('a deletion is a backspace per character removed', () => {
    assert.deepEqual(eventsForChange('abc', 'a', []).events, [{ keysym: KEY.Backspace }, { keysym: KEY.Backspace }])
  })

  it('autocorrect (teh to the) is backspaces then the new letters', () => {
    assert.deepEqual(eventsForChange('teh', 'the', []).events, [{ keysym: KEY.Backspace }, { keysym: KEY.Backspace }, { keysym: 0x68 }, { keysym: 0x65 }])
  })

  it('held modifiers apply to what was typed, and say that something was', () => {
    const result = eventsForChange('', 'c', ['ctrl'])
    assert.equal(result.typedAny, true)
    assert.deepEqual(result.events, [{ keysym: KEY.ControlL, down: true }, { keysym: 0x63 }, { keysym: KEY.ControlL, down: false }])
  })

  it('a pure deletion does not consume held modifiers', () => {
    assert.equal(eventsForChange('ab', 'a', ['ctrl']).typedAny, false)
  })

  it('no change sends nothing', () => {
    assert.deepEqual(eventsForChange('x', 'x', []), { events: [], typedAny: false })
  })
})
