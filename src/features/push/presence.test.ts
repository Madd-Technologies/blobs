import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPresence, type PresenceBody } from './presence.ts'

function harness() {
  const sent: PresenceBody[] = []
  const repeats: (() => void)[] = []
  const presence = createPresence({
    send: async body => void sent.push(body),
    every: run => {
      repeats.push(run)

      return () => repeats.splice(repeats.indexOf(run), 1)
    },
  })

  return { sent, repeats, presence }
}

describe('telling the push plugin what is on screen', () => {
  it('says nothing until this phone is registered and connected', () => {
    const { sent, presence } = harness()
    presence.update({ sessions: ['s1'] })
    presence.update({ online: true })
    assert.deepEqual(sent, [])
  })

  it('says what is on screen when it changes, and repeats it while in front', () => {
    const { sent, repeats, presence } = harness()
    presence.update({ device: 'd1', online: true })
    presence.update({ sessions: ['s1', 'live-1'] })
    presence.update({ sessions: ['s1', 'live-1'] })

    assert.deepEqual(sent, [
      { device: 'd1', foreground: true, sessions: [] },
      { device: 'd1', foreground: true, sessions: ['s1', 'live-1'] },
    ])
    assert.equal(repeats.length, 1)
    repeats[0]?.()
    assert.equal(sent.length, 3, 'the repeat sends again though nothing changed')
  })

  it('says once that it went to the background, with no sessions, and stops repeating', () => {
    const { sent, repeats, presence } = harness()
    presence.update({ device: 'd1', online: true, sessions: ['s1'] })
    presence.update({ foreground: false })

    assert.deepEqual(sent.at(-1), { device: 'd1', foreground: false, sessions: [] })
    assert.equal(repeats.length, 0)
  })

  it('stops repeating while offline', () => {
    const { repeats, presence } = harness()
    presence.update({ device: 'd1', online: true })
    presence.update({ online: false })
    assert.equal(repeats.length, 0)
  })
})
