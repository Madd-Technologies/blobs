import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DeckCard } from '../inbox/deck.ts'
import type { BotView } from '../roster/view.ts'
import { buildWidgetSnapshot } from './widgetSnapshot.ts'

const makeBot = (profile: string, name: string, state: 'idle' | 'working' | 'needsYou'): BotView => ({
  profile,
  name,
  meta: undefined,
  row: {
    name: profile,
    path: `/bots/${profile}`,
    is_default: false,
    model: 'claude-sonnet',
    provider: 'anthropic',
    description: '',
    display_name: name,
    skill_count: 0,
    last_session: null,
    worker_session: null,
    canonical_session: null,
    ui_meta_revisions: {},
    has_avatar: false,
  },
  attention: { state, unread: false },
  preview: '',
  urgent: false,
  age: 'now',
  lastActive: 100,
  mood: 'idle',
  pinned: false,
  waiting: state === 'needsYou' ? 1 : 0,
})

describe('buildWidgetSnapshot', () => {
  it('computes widget counts, top items, and caps bots at 4 / items at 3', () => {
    const views = [
      makeBot('juniper', 'Juniper', 'needsYou'),
      makeBot('scout', 'Scout', 'working'),
      makeBot('harbor', 'Harbor', 'working'),
      makeBot('ember', 'Ember', 'idle'),
      makeBot('moss', 'Moss', 'idle'),
    ]
    const cards: DeckCard[] = [
      {
        kind: 'entry',
        key: 'e1',
        profile: 'juniper',
        entry: { key: 'e1', profile: 'juniper', kind: 'approval', summary: 'Approve push', command: 'git push', inline: true },
      },
      {
        kind: 'board',
        key: 'b1',
        profile: 'scout',
        nowS: 500,
        record: { view: 'v1', view_title: 'Tasks', row: { id: 'r1', title: { key: 't', type: 'text', value: 'Review draft' }, done: false, needs_you: true } },
      },
    ]

    const snap = buildWidgetSnapshot({ views, cards, waitingCount: 4, fleetPaused: false, nowS: 1234.5 })
    assert.equal(snap.needsYouCount, 4)
    assert.equal(snap.activeCount, 2)
    assert.equal(snap.fleetPaused, false)
    assert.equal(snap.bots.length, 4)
    assert.equal(snap.items.length, 2)
    assert.equal(snap.items[0]?.name, 'Juniper')
    assert.equal(snap.updatedAt, 1234)
  })
})
