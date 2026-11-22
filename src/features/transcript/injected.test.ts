import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dashboardSetup, dashboardSetupMessage } from './injected.ts'

describe('dashboardSetup prompt helpers', () => {
  it('formats and parses structured panel starter messages', () => {
    const msg = dashboardSetupMessage('Inbox triage', 'Track important unread emails that need my reply.', 'every morning at 8 AM')
    assert.deepEqual(dashboardSetup(msg), {
      title: 'Inbox triage',
      what: 'Track important unread emails that need my reply.',
    })
  })

  it('recognizes legacy dashboard setup messages and ignores regular user text', () => {
    const legacy = 'Load skill_view("hermes-dashboard:dashboard") and use your dashboard_* tools (find them with tool search) to track something for me on my Blobs app dashboard: a collection with its own fields, kept fresh by a routine. No new plugin. What to track: Weekly expenses'
    assert.deepEqual(dashboardSetup(legacy), {
      title: 'Dashboard panel',
      what: 'Weekly expenses',
    })
    assert.equal(dashboardSetup('Hey can you check my calendar?'), null)
  })
})
