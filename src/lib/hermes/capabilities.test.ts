import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { supportsLiveHelpers, supportsLiveWork } from './capabilities.ts'

describe('supportsLiveWork', () => {
  it('is on from Hermes 0.22.0', () => {
    assert.equal(supportsLiveWork('0.22.0'), true)
    assert.equal(supportsLiveWork('0.22.2'), true)
    assert.equal(supportsLiveWork('1.0.0'), true)
  })

  it('is off for 0.21 servers and when the version is unknown', () => {
    assert.equal(supportsLiveWork('0.21.5'), false)
    assert.equal(supportsLiveWork('0.21.6'), false)
    assert.equal(supportsLiveWork(undefined), false)
    assert.equal(supportsLiveWork(null), false)
    assert.equal(supportsLiveWork(''), false)
    assert.equal(supportsLiveWork('dev'), false)
  })
})

describe('supportsLiveHelpers', () => {
  it('is on from Hermes 0.21.5, where helpers run in the background and report as they go', () => {
    assert.equal(supportsLiveHelpers('0.21.5'), true)
    assert.equal(supportsLiveHelpers('0.21.6'), true)
    assert.equal(supportsLiveHelpers('0.22.2'), true)
  })

  it('is off for older servers and when the version is unknown', () => {
    assert.equal(supportsLiveHelpers('0.21.4'), false)
    assert.equal(supportsLiveHelpers('0.20.9'), false)
    assert.equal(supportsLiveHelpers(undefined), false)
    assert.equal(supportsLiveHelpers('dev'), false)
  })
})
