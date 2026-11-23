import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseApproveParams } from './approveLink.ts'

describe('parseApproveParams', () => {
  it('parses valid approval deep-link query params with optional profile and kind', () => {
    assert.deepEqual(
      parseApproveParams({ id: 'req-42', choice: 'once', profile: 'juniper', kind: 'session' }),
      { id: 'req-42', choice: 'once', profile: 'juniper', kind: 'session' },
    )
    assert.deepEqual(
      parseApproveParams({ id: 'k-1', choice: 'deny', kind: 'weird' }),
      { id: 'k-1', choice: 'deny', kind: 'auto' },
    )
  })

  it('rejects missing id or unknown choice', () => {
    assert.equal(parseApproveParams({ choice: 'once' }), null)
    assert.equal(parseApproveParams({ id: 'req-1', choice: 'approve' }), null)
  })
})
