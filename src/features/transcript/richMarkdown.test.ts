import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseBlock, splitMath, type MathItem } from './richMarkdown.ts'

const lifted = (block: string): { text: string; math: MathItem[] } => {
  const parsed = parseBlock(block)

  assert.equal(parsed.kind, 'markdown', block)

  return parsed.kind === 'markdown' ? { text: parsed.text.replace(/\uE000(\d+)\uE001/g, '«$1»'), math: parsed.math } : { text: '', math: [] }
}

describe('blocks that are only a formula or a diagram', () => {
  it('reads $$…$$ and \\[…\\] on their own, over several lines too', () => {
    assert.deepEqual(parseBlock('$$e^{i\\pi}+1=0$$'), { kind: 'math', tex: 'e^{i\\pi}+1=0' })
    assert.deepEqual(parseBlock('$$\n\\int_0^1 x\\,dx\n= \\frac12\n$$'), { kind: 'math', tex: '\\int_0^1 x\\,dx\n= \\frac12' })
    assert.deepEqual(parseBlock('\\[ a^2+b^2=c^2 \\]'), { kind: 'math', tex: 'a^2+b^2=c^2' })
  })

  it('reads a math, latex or tex fence as a formula', () => {
    assert.deepEqual(parseBlock('```math\nx^2\n```'), { kind: 'math', tex: 'x^2' })
    assert.deepEqual(parseBlock('```latex\n\\frac{1}{2}\n```'), { kind: 'math', tex: '\\frac{1}{2}' })
    assert.deepEqual(parseBlock('~~~tex\nx\n~~~'), { kind: 'math', tex: 'x' })
  })

  it('reads a mermaid fence as a diagram', () => {
    assert.deepEqual(parseBlock('```mermaid\ngraph TD\n  A-->B\n```'), { kind: 'diagram', source: 'graph TD\n  A-->B' })
    assert.deepEqual(parseBlock('```Mermaid\nflowchart LR\n```'), { kind: 'diagram', source: 'flowchart LR' })
  })

  it('leaves an unfinished fence, and any other code block, to the markdown renderer', () => {
    assert.equal(parseBlock('```mermaid\ngraph TD').kind, 'markdown')
    assert.deepEqual(parseBlock('```js\nconst a = "$x$"\n```'), { kind: 'markdown', text: '```js\nconst a = "$x$"\n```', math: [] })
  })

  it('does not take two formulas in a line for one', () => {
    assert.equal(parseBlock('$$a$$ and $$b$$').kind, 'markdown')
  })
})

describe('formulas inside a paragraph', () => {
  it('lifts $…$ out and leaves a placeholder where it was', () => {
    assert.deepEqual(lifted('Let $x_i$ be the $i$-th value.'), { text: 'Let «0» be the «1»-th value.', math: [{ tex: 'x_i', display: false }, { tex: 'i', display: false }] })
  })

  it('does not take prices for formulas', () => {
    for (const text of ['It costs $5 and $10 in total', 'Pay $ 5 now', 'Between $5 and $10.', 'Just a $ sign']) {
      assert.deepEqual(lifted(text), { text, math: [] }, text)
    }
  })

  it('takes a formula that follows a price, even when the price has a dollar of its own', () => {
    assert.deepEqual(lifted('Cost $5 for $x+1$ items').math.map(item => item.tex), ['x+1'])
    assert.deepEqual(lifted('$5 and $6 and $y$').math.map(item => item.tex), ['y'])
  })

  it('reads \\(…\\) and a display formula written in a sentence', () => {
    assert.deepEqual(lifted('So \\(a<b\\) and $$\\sum_i x_i$$ hold.'), { text: 'So «0» and «1» hold.', math: [{ tex: 'a<b', display: false }, { tex: '\\sum_i x_i', display: true }] })
  })

  it('leaves code spans, escaped dollars and a formula across lines alone', () => {
    assert.deepEqual(lifted('Use `$x$` in a prompt and \\$y\\$ for money'), { text: 'Use `$x$` in a prompt and \\$y\\$ for money', math: [] })
    assert.deepEqual(lifted('$a +\nb$'), { text: '$a +\nb$', math: [] })
    assert.deepEqual(lifted('double ``a $x$ b`` span $y$'), { text: 'double ``a $x$ b`` span «0»', math: [{ tex: 'y', display: false }] })
  })

  it('keeps backslashes, stars and underscores inside the formula out of markdown’s way', () => {
    assert.deepEqual(lifted('See $a_1*b_2 \\cdot c^*$ here'), { text: 'See «0» here', math: [{ tex: 'a_1*b_2 \\cdot c^*', display: false }] })
  })

  it('handles a dollar inside the formula with an escape, and an unclosed one as text', () => {
    assert.deepEqual(lifted('$a \\$ b$ ok').math.map(item => item.tex), ['a \\$ b'])
    assert.deepEqual(lifted('$unclosed formula'), { text: '$unclosed formula', math: [] })
  })
})

describe('splitMath', () => {
  it('cuts a rendered string into words and formula numbers', () => {
    const text = parseBlock('a $x$ b $y$ c')

    assert.equal(text.kind, 'markdown')
    assert.deepEqual(splitMath(text.kind === 'markdown' ? text.text : ''), ['a ', 0, ' b ', 1, ' c'])
    assert.deepEqual(splitMath('no formulas'), ['no formulas'])
    assert.deepEqual(splitMath(''), [''])
  })

  it('leaves a broken placeholder as the characters it is', () => {
    assert.deepEqual(splitMath('x \uE000oops\uE001 y'), ['x ', '\uE000oops\uE001', ' y'])
  })
})
