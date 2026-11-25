import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatSharedDraft, normalizeSharedPayload } from './inbox.ts'

describe('share inbox helpers', () => {
  it('normalizes mixed share payloads and ignores empty inputs', () => {
    assert.equal(normalizeSharedPayload(null), null)
    assert.equal(normalizeSharedPayload({ text: '   ', files: [] }), null)

    assert.deepEqual(
      normalizeSharedPayload({
        text: 'Check this article',
        url: 'https://example.com/post',
        files: [{ uri: 'file:///tmp/photo.jpg', name: '', mime: 'image/jpeg' }, { uri: '' }],
      }),
      {
        text: 'Check this article',
        url: 'https://example.com/post',
        files: [{ uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', mime: 'image/jpeg' }],
      },
    )
  })

  it('formats shared draft with note without duplicating matching URL/text', () => {
    const body = formatSharedDraft(
      { text: 'Context snippet', url: 'https://example.com/doc', files: [] },
      'Summarize for me:',
    )
    assert.equal(body, 'Summarize for me:\n\nContext snippet\n\nhttps://example.com/doc')
  })
})
