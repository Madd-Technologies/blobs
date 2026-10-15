import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { configureMath, texToPicture } from './math.ts'
import { createConverter } from './mathEngine.ts'

configureMath(createConverter)

describe('texToPicture', () => {
  it('draws a formula as an SVG with a size', () => {
    const picture = texToPicture('\\frac{a}{b}+\\sqrt{x}', true)

    assert.ok(picture)
    assert.match(picture.xml, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    assert.ok(picture.width > 1 && picture.height > 1)
    assert.ok(picture.xml.includes('currentColor'))
  })

  it('keeps how far it hangs below the baseline, and drops what react-native-svg cannot use', () => {
    const picture = texToPicture('x_{i}', false)

    assert.ok(picture && picture.depth > 0)
    assert.ok(!/<svg[^>]*\sstyle=/.test(picture.xml))
    assert.ok(!/<svg[^>]*\srole=/.test(picture.xml))
  })

  it('reads amsmath, the colour and cancel commands, and a few macros', () => {
    for (const tex of ['\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '\\text{if } x \\in \\mathbb{R}', '\\color{red}{x}', '\\cancel{ab}', '\\boldsymbol{\\alpha}', '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}=\\frac{\\pi^2}{6}']) {
      assert.ok(texToPicture(tex, true), tex)
    }
  })

  it('gives nothing for TeX it cannot read, so the caller can show it as written', () => {
    for (const tex of ['\\frac{a}{', '\\notacommand{x}', '}{', '']) {
      assert.equal(texToPicture(tex, false), null, tex)
    }
  })

  it('answers the same picture twice, from memory', () => {
    assert.equal(texToPicture('a+b', false), texToPicture('a+b', false))
    // The same TeX in the two modes is two pictures.
    assert.notEqual(texToPicture('\\sum_{i}x_i', true)?.height, texToPicture('\\sum_{i}x_i', false)?.height)
  })
})
