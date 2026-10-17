import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { inserted, looksLikePastedPicture } from './paste.ts'

describe('what a change put into the message field', () => {
  it('is the new part, wherever the cursor was, replacing any selection', () => {
    assert.equal(inserted('Hello', 'Hello there'), ' there')
    assert.equal(inserted('Hello world', 'Hello big world'), 'big ')
    assert.equal(inserted('Hello world', 'Hello there'), 'there')
    assert.equal(inserted('abc', 'abc'), '')
    assert.equal(inserted('', 'pasted'), 'pasted')
  })
})

describe('a picture pasted into a field that takes only text', () => {
  // How Android hands a field a JPEG's bytes: the header, then bytes that are not text.
  const jpeg = '����\u0000\u0010JFIF\u0000\u0001\u0001\u0000\u0000H\u0000H\u0000\u0000��\u0000C\u0000\u0006\u0004\u0005\u0006'
  const png = '�PNG\r\n\u001A\n\u0000\u0000\u0000\rIHDR\u0000\u0000\u00048\u0000\u0000\u0007\u0080\b\u0006\u0000\u0000\u0000'

  it('is recognised from its bytes, or from the address the phone gave', () => {
    assert.equal(looksLikePastedPicture(jpeg), true)
    assert.equal(looksLikePastedPicture(png), true)
    assert.equal(looksLikePastedPicture('content://com.android.providers.media.documents/document/image%3A1234'), true)
    assert.equal(looksLikePastedPicture('file:///data/user/0/com.example.keyboard/clipboard/img_1.png'), true)
    assert.equal(looksLikePastedPicture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'), true)
    assert.equal(looksLikePastedPicture(`�${'�\u0003\u0007x'.repeat(20)}`), true)
  })

  it('is never typing, a pasted message, a link, or words about pictures', () => {
    assert.equal(looksLikePastedPicture('h'), false)
    assert.equal(looksLikePastedPicture('Can you check the orders panel?\nThanks'), false)
    assert.equal(looksLikePastedPicture('https://example.com/photo.jpg'), false)
    assert.equal(looksLikePastedPicture('Convert this PNG to JFIF with Exif kept, please'), false)
    assert.equal(looksLikePastedPicture('Tabs\tand\nnew lines\r\nare fine in a long pasted message'), false)
    assert.equal(looksLikePastedPicture('café — “quotes” and emoji 🙂 are text'), false)
  })
})
