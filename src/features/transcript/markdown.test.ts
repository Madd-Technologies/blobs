import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { plainText, splitMarkdownBlocks } from './markdown.ts'

describe('splitMarkdownBlocks', () => {
  it('splits on blank lines', () => {
    assert.deepEqual(splitMarkdownBlocks('One.\n\nTwo.\n\n\nThree.'), ['One.', 'Two.', 'Three.'])
  })

  it('keeps a list or a paragraph with soft line breaks together', () => {
    assert.deepEqual(splitMarkdownBlocks('- a\n- b\n- c\n\nAfter'), ['- a\n- b\n- c', 'After'])
  })

  it('never splits inside a code fence, even across blank lines', () => {
    const text = 'Before\n\n```bash\nline one\n\nline two\n```\n\nAfter'
    assert.deepEqual(splitMarkdownBlocks(text), ['Before', '```bash\nline one\n\nline two\n```', 'After'])
  })

  it('treats an unclosed fence (a reply still streaming) as one growing block', () => {
    assert.deepEqual(splitMarkdownBlocks('Intro\n\n```js\nconst a = 1\n\nconst b'), ['Intro', '```js\nconst a = 1\n\nconst b'])
  })

  it('handles empty and whitespace-only text', () => {
    assert.deepEqual(splitMarkdownBlocks(''), [])
    assert.deepEqual(splitMarkdownBlocks('\n\n  \n'), [])
  })

  it('joining the blocks with blank lines reproduces ordinary text', () => {
    const text = '# Title\n\nPara one\ncontinues.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nEnd'
    assert.equal(splitMarkdownBlocks(text).join('\n\n'), text)
  })
})

describe('a reply as plain text, for sharing', () => {
  it('drops the marks and keeps the words', () => {
    assert.equal(plainText('Yes. That path is a **stream**, not a _saved_ copy, see `StreamingResponse`.'), 'Yes. That path is a stream, not a saved copy, see StreamingResponse.')
  })

  it('keeps code without its fences, lists as bullets, links with their address', () => {
    const text = '## Steps\n- run it:\n```bash\nls -la\n```\n> note\nSee [the docs](https://x.test/d).'
    assert.equal(plainText(text), 'Steps\n• run it:\nls -la\nnote\nSee the docs (https://x.test/d).')
  })

  it('leaves snake_case and multiplication alone', () => {
    assert.equal(plainText('use title__icontains and 2 * 3 * 4'), 'use title__icontains and 2 * 3 * 4')
  })
})
