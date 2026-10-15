import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { BotMeta } from '../../lib/hermes/identity.ts'
import type { ProfileRow } from '../../lib/hermes/protocol.ts'
import { ageLabel, filterRoster, isHidden, isPinned, previewOf, sortRoster, stripPreviewMarkdown } from './derive.ts'

function bot(name: string, lastActive: number, meta?: BotMeta, extra: Partial<ProfileRow> = {}): ProfileRow {
  return {
    name,
    path: `~/.hermes/profiles/${name}`,
    is_default: name === 'default',
    model: 'm',
    provider: 'p',
    description: '',
    display_name: '',
    skill_count: 0,
    last_session: null,
    worker_session: null,
    canonical_session: { id: name, last_active: lastActive },
    ui_meta: meta ? { 'hermes-bots': meta } : undefined,
    ui_meta_revisions: {},
    has_avatar: false,
    ...extra,
  }
}

describe('sortRoster', () => {
  it('puts pinned bots first, then most recently active', () => {
    const rows = [bot('old', 10), bot('new', 90), bot('pinned-old', 5, { pinned: true }), bot('mid', 50)]
    assert.deepEqual(sortRoster(rows).map(row => row.name), ['pinned-old', 'new', 'mid', 'old'])
  })

  it('leaves hidden bots out unless asked', () => {
    const rows = [bot('a', 1), bot('b', 2, { hidden: true })]
    assert.deepEqual(sortRoster(rows).map(row => row.name), ['a'])
    assert.deepEqual(sortRoster(rows, { includeHidden: true }).map(row => row.name), ['b', 'a'])
  })

  it('breaks ties by display name, then by original order', () => {
    const rows = [bot('zeta', 5), bot('alpha', 5), bot('twin-b', 5, { title: 'Same' }), bot('twin-a', 5, { title: 'Same' })]
    assert.deepEqual(sortRoster(rows).map(row => row.name), ['alpha', 'twin-b', 'twin-a', 'zeta'])
  })

  it('does not mutate its input', () => {
    const rows = [bot('b', 1), bot('a', 2)]
    sortRoster(rows)
    assert.deepEqual(rows.map(row => row.name), ['b', 'a'])
  })

  it('exposes pin and hidden flags', () => {
    assert.equal(isPinned(bot('a', 1, { pinned: true })), true)
    assert.equal(isPinned(bot('a', 1)), false)
    assert.equal(isHidden(bot('a', 1, { hidden: true })), true)
  })
})

describe('filterRoster', () => {
  const rows = [bot('forge', 1, { title: 'Forge', description: 'Homelab ops' }), bot('scribe', 2), bot('default', 3)]

  it('matches name, shown name and description, ignoring case', () => {
    assert.deepEqual(filterRoster(rows, 'FORGE').map(row => row.name), ['forge'])
    assert.deepEqual(filterRoster(rows, 'homelab').map(row => row.name), ['forge'])
    assert.deepEqual(filterRoster(rows, 'hermes').map(row => row.name), ['default'], 'the default bot is shown as Hermes')
  })

  it('keeps everything for an empty query', () => {
    assert.equal(filterRoster(rows, '  ').length, 3)
  })
})

describe('previews', () => {
  it('flattens markdown to one plain line', () => {
    assert.equal(stripPreviewMarkdown('# Title\n\n**Bold** and `code` and [a link](http://x)\n```js\nignored()\n```'), 'Title Bold and code and a link')
  })

  it('detects a bot-to-bot message and strips its prefix', () => {
    const row = bot('x', 1, undefined, { canonical_session: { id: 'x', preview: "Message from 🤖 hermes (@hermes): Need a **live** check" } })
    assert.deepEqual(previewOf(row), { text: 'Need a live check', fromBot: 'hermes' })
  })

  it('falls back to the last session preview', () => {
    const row = bot('x', 1, undefined, { canonical_session: null, last_session: { preview: 'hello' } })
    assert.deepEqual(previewOf(row), { text: 'hello', fromBot: null })
  })
})

describe('ageLabel', () => {
  it('uses the compact forms', () => {
    const now = 1_000_000
    assert.equal(ageLabel(now - 10, now), 'now')
    assert.equal(ageLabel(now - 180, now), '3m')
    assert.equal(ageLabel(now - 7_300, now), '2h')
    assert.equal(ageLabel(now - 3 * 86_400, now), '3d')
    assert.equal(ageLabel(now - 15 * 86_400, now), '2w')
    assert.equal(ageLabel(0, now), '')
  })
})
