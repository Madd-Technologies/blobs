import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { replySnippet, splitReply, withReply } from './reply.ts'

describe('replying to a message', () => {
  it('quotes the message as one plain line above your words', () => {
    assert.equal(withReply('The **photos** share is at 91%.\n\nClear the old previews?', 'Yes, do it'), '> The photos share is at 91%. Clear the old previews?\n\nYes, do it')
  })

  it('takes markdown, links and code out of the quote and keeps it short', () => {
    assert.equal(replySnippet('## Plan\n- [Open the quote](https://example.com/q)\n```sh\nrm -rf /tmp/x\n```\nThen `call` Dana.'), 'Plan Open the quote Then call Dana.')
    const long = replySnippet('word '.repeat(80))

    assert.ok(long.length <= 140)
    assert.ok(long.endsWith('…'))
  })

  it('quotes only your words when you reply to a reply', () => {
    assert.equal(withReply('> An older line\n\nMy answer', 'And this'), '> My answer\n\nAnd this')
  })

  it('splits a reply back into its quote and your words, and leaves other messages alone', () => {
    assert.deepEqual(splitReply('> The photos share is at 91%.\n\nYes, do it'), { quote: 'The photos share is at 91%.', body: 'Yes, do it' })
    assert.deepEqual(splitReply('> a quote with no reply after it'), { quote: '', body: '> a quote with no reply after it' })
    assert.deepEqual(splitReply('Plain message'), { quote: '', body: 'Plain message' })
  })

  it('sends just your words when there is nothing to quote', () => {
    assert.equal(withReply('```\ncode only\n```', 'Thanks'), 'Thanks')
  })
})
