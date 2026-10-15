import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { speechChunks, speechText } from './speech.ts'

describe('speechText', () => {
  it('drops emphasis, heading and list marks and keeps the words', () => {
    assert.equal(speechText('# Title\n\nSome **bold**, *italic* and ~~gone~~ words.\n\n- one\n- two\n1. three'), 'Title\n\nSome bold, italic and gone words.\n\none\ntwo\nthree')
  })

  it('says a code block was there instead of reading it, and keeps inline code’s words', () => {
    assert.equal(speechText('Run it:\n\n```bash\nrm -rf /tmp/x\n```\n\nThen use `docker compose up`.'), 'Run it:\n\nCode block.\n\nThen use docker compose up.')
    assert.equal(speechText('```js\nunclosed code'), 'Code block.')
  })

  it('keeps a link’s words, not its address, and says "link" for a bare address', () => {
    assert.equal(speechText('See [the docs](https://example.com/a?b=c) or https://example.com/x for more.'), 'See the docs or link for more.')
    assert.equal(speechText('![a chart](https://x/y.png)'), 'a chart')
  })

  it('says "formula" for math and leaves prices alone', () => {
    assert.equal(speechText('So $x_1 + y$ holds and $$\\int_0^1 f$$ too.'), 'So formula holds and formula too.')
    assert.equal(speechText('It costs $5 and $10.'), 'It costs $5 and $10.')
  })

  it('does not read file lines, table rules or pipes', () => {
    assert.equal(speechText('Here it is.\nMEDIA:/home/orion/a.png'), 'Here it is.')
    assert.equal(speechText('| name | value |\n| --- | --- |\n| a | 1 |\n| b | 2 |'), 'name, value.\n\na, 1.\nb, 2.')
  })

  it('turns escapes back into the characters, and strips html tags', () => {
    assert.equal(speechText('Use \\* and \\_ here <b>now</b>'), 'Use * and _ here now')
  })

  it('collapses runs of space and blank lines', () => {
    assert.equal(speechText('a   b\n\n\n\n c'), 'a b\n\nc')
    assert.equal(speechText('   '), '')
  })
})

describe('speechChunks', () => {
  it('keeps short text as one piece', () => {
    assert.deepEqual(speechChunks('Hello there.\n\nSecond paragraph.'), ['Hello there.\n\nSecond paragraph.'])
  })

  it('cuts at paragraphs first, never beyond the limit', () => {
    const chunks = speechChunks('aaaa\n\nbbbb\n\ncccc', 10)

    // The blank line after each paragraph counts toward the limit.
    assert.deepEqual(chunks, ['aaaa', 'bbbb', 'cccc'])
    assert.deepEqual(speechChunks('aaaa\n\nbbbb\n\ncccc', 12), ['aaaa\n\nbbbb', 'cccc'])
    assert.ok(chunks.every(chunk => chunk.length <= 10))
  })

  it('cuts a long paragraph at sentences, and a long sentence at words', () => {
    const sentences = speechChunks('One two three. Four five six. Seven eight nine.', 20)

    assert.ok(sentences.length > 1 && sentences.every(chunk => chunk.length <= 20), JSON.stringify(sentences))
    assert.equal(sentences.join(' ').replace(/\s+/g, ' '), 'One two three. Four five six. Seven eight nine.')
    const words = speechChunks('alpha beta gamma delta epsilon', 12)

    assert.ok(words.every(chunk => chunk.length <= 12), JSON.stringify(words))
    assert.equal(words.join(' '), 'alpha beta gamma delta epsilon')
  })

  it('splits a word longer than the limit rather than dropping it, and gives nothing for nothing', () => {
    assert.ok(speechChunks('x'.repeat(25), 10).every(chunk => chunk.length <= 10))
    assert.deepEqual(speechChunks(''), [])
  })
})
