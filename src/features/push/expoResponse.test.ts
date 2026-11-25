import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveNotificationResponseUrl } from './expoResponse.ts'

describe('resolveNotificationResponseUrl', () => {
  const sampleData = {
    url: 'hermesbot://bot/leto',
    approval: { id: 'req-42', profile: 'leto', kind: 'session' },
  }

  it('builds approval deep links for interactive Allow once and Deny actions', () => {
    assert.equal(
      resolveNotificationResponseUrl('ALLOW_ONCE', sampleData),
      'hermesbot://approve?id=req-42&choice=once&profile=leto&kind=session',
    )
    assert.equal(
      resolveNotificationResponseUrl('DENY', sampleData),
      'hermesbot://approve?id=req-42&choice=deny&profile=leto&kind=session',
    )
  })

  it('returns the target hermesbot:// url on a default tap', () => {
    assert.equal(
      resolveNotificationResponseUrl('expo.modules.notifications.actions.DEFAULT', sampleData),
      'hermesbot://bot/leto',
    )
  })

  it('rejects non-hermesbot urls and empty or malformed payloads', () => {
    assert.equal(resolveNotificationResponseUrl('DEFAULT', { url: 'https://evil.example' }), null)
    assert.equal(resolveNotificationResponseUrl('ALLOW_ONCE', { approval: { id: '' } }), null)
    assert.equal(resolveNotificationResponseUrl('DEFAULT', null), null)
    assert.equal(resolveNotificationResponseUrl('DEFAULT', undefined), null)
  })
})
