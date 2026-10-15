import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mix, palettes, tintLevel, tintPalette } from './tokens.ts'

const FORGE = '#F97352'

describe('Card Stock tint', () => {
  it('tints Forge’s dark paper to the expected values', () => {
    const forge = tintPalette('dark', FORGE)

    assert.equal(forge.canvas, '#140E0D')
    assert.equal(forge.sheet, '#1F1919')
    assert.equal(forge.tone, '#292122')
    assert.equal(forge.raised, '#352B2C')
    assert.equal(forge.edge, '#473D3E')
    assert.equal(forge.control, '#1F1919', 'icon circles on a bot’s canvas are its sheet')
    assert.equal(forge.pressedIn, '#1F1919', 'Deny pressed into the approval card')
  })

  it('reproduces the pinned tiles and deck cards', () => {
    assert.equal(tintLevel('dark', 'pinned', '#8B5CF6'), '#24202E')
    assert.equal(tintLevel('dark', 'pinned', FORGE), '#2B2223')
    assert.equal(tintLevel('dark', 'pinned', '#3B82F6'), '#1E232E')
    assert.equal(tintLevel('dark', 'pinned', '#14B8A6'), '#1B2728')
    assert.equal(tintLevel('dark', 'raised', '#84CC16'), '#2D3228', 'Concierge’s top card')
    assert.equal(tintLevel('dark', 'sheet', '#84CC16'), '#1A1D16', 'Open chat pressed into it')
    assert.equal(tintLevel('dark', 'tone', FORGE), '#292122', 'Forge, next in the deck')
    assert.equal(tintLevel('dark', 'sheet', '#3B82F6'), '#161A21', 'Courier, third')
  })

  it('tints Forge’s light paper to the expected values', () => {
    const forge = tintPalette('light', FORGE)

    assert.equal(forge.canvas, '#FAF3F2')
    assert.equal(forge.sheet, '#F1E9E8')
    assert.equal(forge.tone, '#E7DEDE')
    assert.equal(forge.raised, '#FFFDFD')
    assert.equal(forge.pressedIn, '#F3EBEA')
  })

  it('leaves neutral paper alone without a face', () => {
    assert.equal(tintLevel('dark', 'canvas', null), palettes.dark.canvas)
    assert.equal(tintLevel('light', 'pinned', undefined), palettes.light.tone)
  })

  it('reads the hsl() colors profiles get by name', () => {
    assert.equal(mix('#000000', 'hsl(0 100% 50%)', 1), '#FF0000')
    assert.equal(mix('#000000', 'hsl(120, 100%, 25%)', 1), '#008000')
    assert.equal(mix('#000000', 'rgb(10, 20, 30)', 1), '#0A141E')
    assert.equal(mix('#000000', '#fff', 0.5), '#808080')
  })
})
