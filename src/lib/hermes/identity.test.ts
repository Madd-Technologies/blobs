import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  avatarColor,
  botAppearance,
  defaultShapeFor,
  displayName,
  PRIMARY_AVATAR_COLOR,
  PROFILE_SWATCHES,
  profileColor,
} from './identity.ts'

/** Generated from Desktop's own code by scripts/gen-golden-identity.mjs. */
const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-identity.json', import.meta.url), 'utf8')) as {
  colors: { name: string; color: string | null }[]
  shapes: { name: string; shape: string }[]
  appearances: { name: string; meta: Parameters<typeof botAppearance>[1]; appearance: ReturnType<typeof botAppearance> }[]
}

describe('profileColor (golden vs Desktop)', () => {
  for (const { name, color } of golden.colors) {
    it(`matches for ${JSON.stringify(name.length > 20 ? `${name.slice(0, 20)}…` : name)}`, () => {
      assert.equal(profileColor(name), color)
    })
  }

  it('is neutral for default/empty and space-separated hsl otherwise', () => {
    assert.equal(profileColor('default'), null)
    assert.equal(profileColor(undefined), null)
    assert.match(profileColor('forge') ?? '', /^hsl\(\d+ 68% 58%\)$/)
  })

  it('offers twelve evenly spaced swatches', () => {
    assert.equal(PROFILE_SWATCHES.length, 12)
    assert.equal(PROFILE_SWATCHES[0], 'hsl(0 68% 58%)')
    assert.equal(PROFILE_SWATCHES[11], 'hsl(330 68% 58%)')
  })
})

describe('defaultShapeFor (golden vs Desktop)', () => {
  for (const { name, shape } of golden.shapes) {
    it(`matches for ${JSON.stringify(name.length > 20 ? `${name.slice(0, 20)}…` : name)}`, () => {
      assert.equal(defaultShapeFor(name), shape)
    })
  }
})

describe('botAppearance (golden vs Desktop)', () => {
  for (const { name, meta, appearance } of golden.appearances) {
    it(`matches for ${name} ${JSON.stringify(meta)}`, () => {
      assert.deepEqual(botAppearance(name, meta), appearance)
    })
  }
})

describe('avatarColor', () => {
  it('prefers a picked color, then the name hue, then the primary violet', () => {
    assert.equal(avatarColor('#123456', 'forge'), '#123456')
    assert.equal(avatarColor(null, 'forge'), profileColor('forge'))
    assert.equal(avatarColor(null, 'default'), PRIMARY_AVATAR_COLOR)
    assert.equal(avatarColor(undefined, ''), PRIMARY_AVATAR_COLOR)
  })
})

describe('displayName', () => {
  it('prefers the ui_meta title', () => {
    assert.equal(displayName({ name: 'zz-alpha', display_name: 'Alpha' }, { title: '  Scout  ' }), 'Scout')
  })

  it('then the profile display_name', () => {
    assert.equal(displayName({ name: 'zz-alpha', display_name: ' Alpha ' }), 'Alpha')
  })

  it('shows the default profile as Hermes', () => {
    assert.equal(displayName({ name: 'default' }), 'Hermes')
    assert.equal(displayName({ name: 'Default' }), 'Hermes')
    assert.equal(displayName({ name: 'default', display_name: 'Main' }), 'Main')
  })

  it('title-cases a slug as the last resort', () => {
    assert.equal(displayName({ name: 'night-shift_ops' }), 'Night Shift Ops')
    assert.equal(displayName({ name: 'laptop' }), 'Laptop')
  })

  it('uses the row title (a role) before the slug, like Desktop', () => {
    assert.equal(displayName({ name: 'zz-alpha', title: 'code reviewer' }), 'Code Reviewer')
    assert.equal(displayName({ name: 'default', title: 'chief of staff' }), 'Chief Of Staff')
  })
})
