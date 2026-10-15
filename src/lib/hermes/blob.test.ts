import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BLOB_KIND_TRAIT, BLOB_KINDS, blobShapeString, blobSvg, isBlobShape, parseBlobShape, splitBlob } from './blob.ts'

describe('blob shape strings', () => {
  it('recognizes blobatar shapes only', () => {
    assert.equal(isBlobShape('blobatar'), true)
    assert.equal(isBlobShape('blobatar:abc'), true)
    assert.equal(isBlobShape('blobatar::sun'), true)
    assert.equal(isBlobShape('blob'), false)
    assert.equal(isBlobShape('circle'), false)
    assert.equal(isBlobShape(null), false)
  })

  it('parses the four documented forms', () => {
    assert.deepEqual(parseBlobShape('blobatar', 'forge'), { seed: 'forge', seedPart: '', kind: '' })
    assert.deepEqual(parseBlobShape('blobatar:abc', 'forge'), { seed: 'abc', seedPart: 'abc', kind: '' })
    assert.deepEqual(parseBlobShape('blobatar:abc:sun', 'forge'), { seed: 'abc', seedPart: 'abc', kind: 'sun' })
    assert.deepEqual(parseBlobShape('blobatar::sun', 'forge'), { seed: 'forge', seedPart: '', kind: 'sun' })
  })

  it('ignores an unknown kind and falls back to "agent" with no name', () => {
    assert.equal(parseBlobShape('blobatar:abc:nope', 'forge').kind, '')
    assert.equal(parseBlobShape('blobatar', undefined).seed, 'agent')
  })

  it('round-trips through blobShapeString', () => {
    assert.equal(blobShapeString('', ''), 'blobatar')
    assert.equal(blobShapeString('abc', ''), 'blobatar:abc')
    assert.equal(blobShapeString('abc', 'sun'), 'blobatar:abc:sun')
  })

  it('has a trait position for every silhouette', () => {
    for (const kind of BLOB_KINDS) {
      assert.ok(BLOB_KIND_TRAIT[kind] > 0 && BLOB_KIND_TRAIT[kind] < 1, kind)
    }
  })
})

describe('blobSvg', () => {
  it('renders deterministic SVG per seed', () => {
    const a = blobSvg('blobatar', 'zz-alpha', 40)
    assert.ok(a?.startsWith('<svg'))
    assert.equal(a, blobSvg('blobatar', 'zz-alpha', 40))
    assert.notEqual(a, blobSvg('blobatar', 'zz-beta', 40))
  })

  it('a pinned silhouette changes the shape but not the seed-driven colors', () => {
    assert.notEqual(blobSvg('blobatar:abc:sun', 'x', 40), blobSvg('blobatar:abc:round', 'x', 40))
  })
})

describe('splitting a blobatar into body and eyes', () => {
  it('gives two documents of the same frame, the eyes alone in the second, and the eye line', () => {
    for (const name of ['default', 'zz-room-a', 'forge', 'orion', 'a', 'juniper']) {
      for (const kind of ['', ...BLOB_KINDS]) {
        const xml = blobSvg(kind ? `blobatar::${kind}` : 'blobatar', name, 44) as string
        const parts = splitBlob(xml)

        assert.ok(parts, `${name} ${kind}`)
        assert.match(parts.body, /^<svg[^>]*viewBox="0 0 100 100"[^>]*>.*<\/svg>$/s)
        assert.equal((parts.body.match(/<g\b/g) ?? []).length, 1)
        assert.equal((parts.eyes.match(/<g\b/g) ?? []).length, 1)
        assert.equal(parts.body.length + parts.eyes.length - xml.length, parts.body.indexOf('<g') + '</svg>'.length, 'nothing lost: only the <svg> tags are repeated')
        assert.ok(parts.eyeLine > 0.25 && parts.eyeLine < 0.75, `${name} ${kind}: eye line ${parts.eyeLine}`)
      }
    }
  })

  it('reads the eye line from the path data, not the colour', () => {
    const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="44" height="44"><g fill="#c5cdff"><circle cx="50" cy="50" r="40"/></g><g fill="#0d0f18"><path d="M40 40C40 60 44 60 44 40Z"/><path d="M56 40C56 60 60 60 60 40Z"/></g></svg>'
    assert.equal(splitBlob(xml)?.eyeLine, 0.5)
  })

  it('leaves anything else whole', () => {
    assert.equal(splitBlob('<svg viewBox="0 0 100 100"><path d="M0 0"/></svg>'), null)
    assert.equal(splitBlob('not svg'), null)
  })
})
