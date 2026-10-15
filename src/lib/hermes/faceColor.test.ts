import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { faceColor } from './faceColor.ts'
import { PRIMARY_AVATAR_COLOR } from './identity.ts'

describe('faceColor', () => {
  it('is the picked color for a classic shape', () => {
    assert.equal(faceColor('forge', { shape: 'hexagon', color: '#F97352' }), '#F97352')
  })

  it('is the primary violet for the default bot left as it is', () => {
    assert.equal(faceColor('default', null), PRIMARY_AVATAR_COLOR)
  })

  it('is the body color of a blob face, which brings its own palette', () => {
    const color = faceColor('zz-alpha', { shape: 'blobatar' })

    assert.match(color, /^#[0-9a-f]{6}$/i)
    assert.equal(faceColor('zz-alpha', { shape: 'blobatar' }), color, 'the same every time')
  })
})
