import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { buildFace, isDarkColor, parseColor, ringToPath, sampleFaceRing, sigilGeometry, type RingFace, type SigilFace } from './face.ts'

interface GoldenRing {
  viewBox: string
  body: string
  eyes: { cx: number; cy: number; rx: number; ry: number; fill: string }[]
  highlights: { cx: number; cy: number; r: number; fill: string }[]
  dots: { cx: number; cy: number; r: number; opacity: number }[]
  shut: string
}

const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-identity.json', import.meta.url), 'utf8')) as {
  faces: { shape: string; color: string; mood: 'idle' | 'work'; face: GoldenRing }[]
  sigils: { shape: string; name: string; face: { viewBox: string; ring: string | null; strokes: string; eyes: { cx: number; cy: number; r: number }[] } }[]
}

describe('buildFace ring faces (golden vs Desktop BotFace)', () => {
  for (const { shape, color, mood, face: want } of golden.faces) {
    it(`${shape} ${color} ${mood}`, () => {
      const got = buildFace(shape, color, 'zz-alpha', mood) as RingFace
      assert.equal(got.type, 'ring')
      assert.equal(got.viewBox, want.viewBox)
      assert.equal(got.body, want.body)
      assert.deepEqual(
        got.eyes.map(e => ({ ...e, fill: got.eyeFill })),
        want.eyes,
      )
      assert.deepEqual(
        got.highlights.map(h => ({ ...h, fill: got.highlightFill })),
        want.highlights,
      )
      assert.deepEqual(got.dots, want.dots)
      assert.equal(got.shut, want.shut)
    })
  }
})

describe('buildFace sigils (golden vs Desktop BotFace)', () => {
  for (const { shape, name, face: want } of golden.sigils) {
    it(`${shape} for ${name}`, () => {
      const got = buildFace(shape, '#84cc16', name) as SigilFace
      assert.equal(got.type, 'sigil')
      assert.equal(got.viewBox, want.viewBox)
      assert.equal(got.ring, want.ring)
      assert.equal(got.strokes, want.strokes)
      assert.deepEqual(got.eyes, want.eyes)
    })
  }

  it('is deterministic per name and seed', () => {
    assert.deepEqual(sigilGeometry('forge', 4), sigilGeometry('forge', 4))
    assert.notDeepEqual(sigilGeometry('forge', 4), sigilGeometry('forge', 5))
  })
})

describe('moods', () => {
  it('shows pulsing dots only while working', () => {
    assert.equal((buildFace('circle', '#8b5cf6', 'x', 'idle') as RingFace).dots.length, 0)
    assert.equal((buildFace('circle', '#8b5cf6', 'x', 'off') as RingFace).dots.length, 0)
    assert.equal((buildFace('circle', '#8b5cf6', 'x', 'work') as RingFace).dots.length, 3)
  })

  it('sits the cloud eyes lower, with catchlights riding along', () => {
    const cloud = buildFace('cloud', '#14b8a6', 'x') as RingFace
    assert.equal(cloud.eyes[0].cy, 22)
    assert.equal(cloud.highlights[0].cy, 22 - 0.7)
  })
})

describe('outline sampling', () => {
  it('produces closed, finite paths for every shape', () => {
    for (const shape of ['circle', 'blob', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop', 'whatever']) {
      const ring = sampleFaceRing(shape)
      assert.ok(ring.length >= 8, shape)
      assert.ok(ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), shape)
      assert.match(ringToPath(ring), /^M[\d. -]+(L[\d. -]+)+Z$/, shape)
    }
  })

  it('returns an empty path for an empty ring', () => {
    assert.equal(ringToPath([]), '')
  })
})

describe('parseColor / isDarkColor', () => {
  it('parses hex, rgb and hsl', () => {
    assert.deepEqual(parseColor('#fff'), [255, 255, 255])
    assert.deepEqual(parseColor('#8b5cf6'), [139, 92, 246])
    assert.deepEqual(parseColor('rgb(10, 20, 30)'), [10, 20, 30])
    assert.deepEqual(parseColor('hsl(0 100% 50%)'), [255, 0, 0])
    assert.deepEqual(parseColor('hsl(120, 100%, 25%)'), [0, 128, 0])
    assert.equal(parseColor('not a color'), null)
    assert.equal(parseColor('hsl(x y z)'), null)
  })

  it('flips eyes light on dark bodies, including hsl (Desktop only handled #rrggbb)', () => {
    assert.equal(isDarkColor('#1a1a1a'), true)
    assert.equal(isDarkColor('#8b5cf6'), false)
    assert.equal(isDarkColor('hsl(240 68% 20%)'), true)
    assert.equal(isDarkColor('hsl(60 68% 58%)'), false)
    assert.equal(isDarkColor('garbage'), false)
  })
})
