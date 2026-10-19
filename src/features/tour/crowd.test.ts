import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { splitBlob } from '../../lib/hermes/blob.ts'
import { CROWD_ORDER, crowdColor, crowdSvg } from './crowd.ts'

describe('the brand crowd', () => {
  it('draws Courier exactly as the website favicon', () => {
    const favicon = readFileSync(new URL('../../../site/favicon.svg', import.meta.url), 'utf8').trim()
    const body = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<g class="eyes"/, '<g')

    assert.equal(body(crowdSvg('courier', 100)), body(favicon))
  })

  it('gives every face eyes of their own, so they can blink and look around', () => {
    for (const id of CROWD_ORDER) {
      assert.ok(splitBlob(crowdSvg(id, 96)), `${id} splits into a body and eyes`)
    }
  })

  it('reads each body color, for the paper it tints', () => {
    assert.equal(crowdColor('courier'), '#00bbda')
    assert.equal(new Set(CROWD_ORDER.map(crowdColor)).size, 5, 'five different colors')
  })
})
