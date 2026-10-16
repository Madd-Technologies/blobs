import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { CAST, CAST_ORDER, CROPS, CROSSFADE, cropFor, DESIGN, lifted, OUTPUTS, phoneTop, PREVIEW, REFERENCE, shade, STILLS, timeline, type Platform } from './set.ts'

describe('the cast', () => {
  it('draws the same five faces as the demo seeds', () => {
    const seed = readFileSync(new URL('../../scripts/demo/seed.ts', import.meta.url), 'utf8')

    for (const name of CAST_ORDER) {
      const { seed: blobSeed, kind } = CAST[name]
      assert.match(seed, new RegExp(`name: '${name}',[\\s\\S]*?shape: 'blobatar:${blobSeed}:${kind}'`), `${name} is ${blobSeed}:${kind} in seed.ts`)
    }
  })
})

describe('the crops', () => {
  it('stay inside the captures they were measured on', () => {
    for (const platform of Object.keys(CROPS) as Platform[]) {
      const { width, height } = REFERENCE[platform]

      for (const [name, crop] of Object.entries(CROPS[platform])) {
        assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= width && crop.y + crop.h <= height, `${platform} ${name} fits ${width}x${height}`)
        assert.ok(crop.radius < Math.min(crop.w, crop.h) / 2, `${platform} ${name} radius`)
      }
    }
  })

  it('scale with the width of the capture actually taken', () => {
    assert.deepEqual(cropFor('iphone', 'approval', 1320), CROPS.iphone.approval)

    const half = cropFor('iphone', 'approval', 660)
    assert.equal(half.w, CROPS.iphone.approval.w / 2)
    assert.equal(half.y, CROPS.iphone.approval.y / 2)
  })
})

describe('the colours', () => {
  it('shades toward black', () => {
    assert.equal(shade('#00bbdd', 0), '#00bbdd')
    assert.equal(shade('#00bbdd', 1), '#000000')
    assert.equal(shade('#ffffff', 0.5), '#808080')
  })
})

describe('the stills', () => {
  it('are seven frames with their own names and two or three lines of headline', () => {
    assert.equal(STILLS.length, 7)
    assert.equal(new Set(STILLS.map(frame => frame.id)).size, STILLS.length)

    for (const frame of STILLS) {
      assert.ok(frame.headline.length >= 2 && frame.headline.length <= 3, frame.id)
    }
  })

  it('open on black with the whole cast, then take a bot colour each', () => {
    assert.equal(STILLS[0]?.bot, null)
    assert.ok(STILLS.slice(1).every(frame => frame.bot !== null))
  })

  it('drop the phone for a longer headline', () => {
    assert.equal(phoneTop({ headline: ['a', 'b'] }), 300)
    assert.equal(phoneTop({ headline: ['a', 'b', 'c'] }), 330)
    assert.equal(phoneTop({ headline: ['a', 'b'], sub: 'c' }), 330)
  })

  it('lift their card out of the phone, larger, without leaving the frame or covering the headline', () => {
    for (const platform of ['iphone', 'android'] as const) {
      for (const frame of STILLS) {
        const card = lifted(frame, platform, REFERENCE[platform])
        assert.ok(card, `${platform} ${frame.id} has a card`)
        assert.ok(card.x >= 0 && card.x + card.width <= DESIGN.width, `${platform} ${frame.id} fits across`)
        assert.ok(card.y >= phoneTop(frame) && card.y + card.height <= DESIGN.height, `${platform} ${frame.id} fits down`)
        assert.ok(card.width > card.crop.w * (326 / REFERENCE[platform].width), `${platform} ${frame.id} is larger than in the phone`)
      }
    }
  })

  it('cover their original completely, so no sliver of it shows beside the lifted card', () => {
    const tilt = Math.sin((3 * Math.PI) / 180)

    for (const platform of ['iphone', 'android'] as const) {
      for (const frame of STILLS) {
        const card = lifted(frame, platform, REFERENCE[platform])!
        const perPixel = 326 / REFERENCE[platform].width
        const original = { w: card.crop.w * perPixel, h: card.crop.h * perPixel }
        // How far the original reaches from its centre, its corners swung by the phone's tilt.
        const across = original.w / 2 + (original.h / 2) * tilt
        const down = original.h / 2 + (original.w / 2) * tilt

        assert.ok(card.x <= card.origin.x - across && card.x + card.width >= card.origin.x + across, `${platform} ${frame.id} covers it across`)
        assert.ok(card.y <= card.origin.y - down && card.y + card.height >= Math.min(card.origin.y + down, DESIGN.height), `${platform} ${frame.id} covers it down`)
      }
    }
  })

  it('cover the card it lifts: centred where it sits in an upright phone', () => {
    const frame = { ...STILLS[0]!, phone: 'center' as const }
    const card = lifted(frame, 'iphone', REFERENCE.iphone)!
    const perPixel = 326 / 1320
    const centre = phoneTop(frame) + 7 + (CROPS.iphone.needsCard.y + CROPS.iphone.needsCard.h / 2) * perPixel
    assert.ok(Math.abs(card.y + card.height / 2 - centre) < 0.01)
  })
})

describe('the App Store preview', () => {
  const { items, total } = timeline(PREVIEW, OUTPUTS.appStorePreview.fps)

  it('runs 15 to 30 seconds, as Apple requires', () => {
    const seconds = total / OUTPUTS.appStorePreview.fps
    assert.ok(seconds >= 15 && seconds <= 30, `${seconds} s`)
  })

  it('overlaps each segment with the one before by the crossfade', () => {
    assert.equal(items[0]?.start, 0)

    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1]!
      assert.equal(items[index]?.start, previous.start + previous.duration - CROSSFADE)
    }
  })

  it('plays a real window of each clip, longer than the crossfades around it', () => {
    for (const segment of PREVIEW) {
      assert.ok(segment.from >= 0 && segment.to > segment.from, segment.id)
      assert.ok((segment.to - segment.from) * OUTPUTS.appStorePreview.fps > 2 * CROSSFADE, segment.id)
    }
  })
})
