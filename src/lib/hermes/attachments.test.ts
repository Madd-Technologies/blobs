import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcGatewayError } from './gateway-client.ts'
import { bytesToBase64, chipOf, cleanName, describeSize, kindOf, MAX_ATTACHMENT_BYTES, messageFor, photoName, refusal, uploadAttachment, type Uploaded } from './attachments.ts'
import type { RpcClient } from './rpc.ts'

function client(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const rpc: RpcClient = {
    async request<T>(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })

      return (await handler(method, params)) as T
    },
  }

  return { rpc, calls }
}

describe('what kind of file it is', () => {
  it('sends pictures as pictures, PDFs as pages and everything else as a file', () => {
    assert.equal(kindOf('IMG_1.JPG'), 'image')
    assert.equal(kindOf('shot.png', 'image/png'), 'image')
    assert.equal(kindOf('x', 'image/webp'), 'image')
    assert.equal(kindOf('doc.pdf'), 'pdf')
    assert.equal(kindOf('doc', 'application/pdf'), 'pdf')
    assert.equal(kindOf('notes.txt', 'text/plain'), 'file')
    assert.equal(kindOf('archive.zip'), 'file')
  })

  it('treats a picture type the server cannot read as a file, not a broken image', () => {
    assert.equal(kindOf('IMG_2.heic', 'image/heic'), 'file')
    assert.equal(kindOf('x.svg', 'image/svg+xml'), 'file')
  })
})

describe('a photo’s name', () => {
  it('keeps the library’s name', () => {
    assert.equal(photoName('Holiday.jpg', 'file:///cache/ImagePicker/abc.jpg', 'image/jpeg'), 'Holiday.jpg')
  })

  it('uses the extension of the file the app holds when the picker converted a HEIC photo', () => {
    assert.equal(photoName('IMG_0042.HEIC', 'file:///cache/ImagePicker/abc.jpg', 'image/jpeg'), 'IMG_0042.jpg')
  })

  it('makes up a name from the file when the library gave none', () => {
    assert.equal(photoName(null, 'file:///cache/ImagePicker/abc-123.png?x=1', 'image/png'), 'abc-123.png')
    assert.equal(photoName(undefined, '', 'image/jpeg'), 'photo.jpg')
  })

  it('goes by the type when the file has no usable extension', () => {
    assert.equal(photoName('photo', 'content://media/external/1234', 'image/jpeg'), 'photo.jpg')
  })
})

describe('names and sizes', () => {
  it('cleans a name', () => {
    assert.equal(cleanName('/private/var/x/My Photo.jpg'), 'My Photo.jpg')
    assert.equal(cleanName('a\\b\\c.txt'), 'c.txt')
    assert.equal(cleanName('..hidden'), 'hidden')
    assert.equal(cleanName('', 'photo.jpg'), 'photo.jpg')
    assert.equal(cleanName('bad\u0000name.txt'), 'bad_name.txt')
  })

  it('words a size', () => {
    assert.equal(describeSize(undefined), '')
    assert.equal(describeSize(10), '1 KB')
    assert.equal(describeSize(2048), '2 KB')
    assert.equal(describeSize(3 * 1024 * 1024), '3.0 MB')
  })

  it('refuses an empty file or one over the limit, before uploading it', () => {
    assert.equal(refusal({ name: 'a.png', kind: 'image', size: 100 }), null)
    assert.equal(refusal({ name: 'a.png', kind: 'image' }), null)
    assert.match(refusal({ name: 'a.png', kind: 'image', size: 0 }) ?? '', /empty/)
    // A phone's own photo format would only be refused by the server after the upload.
    assert.match(refusal({ name: 'IMG_4821.HEIC', kind: 'image', size: 100 }) ?? '', /IMG_4821\.HEIC is in a format the server cannot read as a picture \(HEIC\)\. Send it as a JPEG\./)
    assert.match(refusal({ name: 'scan.tiff', kind: 'image' }) ?? '', /cannot read as a picture\. Send it as a JPEG/)
    // Other kinds of file are not pictures: any name goes.
    assert.equal(refusal({ name: 'IMG_4821.heic', kind: 'file', size: 100 }), null)
    assert.match(refusal({ name: 'big.zip', kind: 'file', size: MAX_ATTACHMENT_BYTES + 1 }) ?? '', /limit is 25\.0 MB/)
  })
})

describe('uploading', () => {
  it('queues an image on the session', async () => {
    const c = client(() => ({ attached: true, text: '[User attached image: upload_1.png]', path: '/p' }))
    const done = await uploadAttachment(c.rpc, 'live1', { kind: 'image', name: 'My Photo.jpg', mime: 'image/jpeg' }, 'QUJD')
    assert.deepEqual(c.calls[0], { method: 'image.attach_bytes', params: { session_id: 'live1', content_base64: 'QUJD', filename: 'My Photo.jpg' } })
    assert.deepEqual(done, { kind: 'image', name: 'My Photo.jpg', hint: '[User attached image: upload_1.png]' })
  })

  it('says why when the server did not take an image', async () => {
    const c = client(() => ({ attached: false, message: 'unsupported' }))
    await assert.rejects(uploadAttachment(c.rpc, 'live1', { kind: 'image', name: 'a.png', mime: 'image/png' }, 'QUJD'), /unsupported/)
  })

  it('renders a PDF into pages', async () => {
    const c = client(() => ({ attached: true, filename: 'doc.pdf', pages_attached: 3, text: '[User attached PDF: doc.pdf (3 page(s))]' }))
    const done = await uploadAttachment(c.rpc, 'live1', { kind: 'pdf', name: 'doc.pdf', mime: 'application/pdf' }, 'QUJD')
    assert.equal(c.calls[0]?.method, 'pdf.attach')
    assert.equal(done.hint, '[User attached PDF: doc.pdf (3 page(s))]')
    assert.equal(done.refText, undefined)
  })

  it('hands the bot a PDF as a file when the server cannot render pages (no pdftoppm)', async () => {
    const c = client(method => {
      if (method === 'pdf.attach') {
        throw new JsonRpcGatewayError('pdftoppm not installed', { code: 5028 })
      }

      return { attached: true, name: 'doc.pdf', path: '/w/doc.pdf', ref_text: '@file:doc.pdf', uploaded: true }
    })
    const done = await uploadAttachment(c.rpc, 'live1', { kind: 'pdf', name: 'doc.pdf', mime: 'application/pdf' }, 'QUJD')
    assert.deepEqual(c.calls.map(call => call.method), ['pdf.attach', 'file.attach'])
    assert.equal(c.calls[1]?.params.data_url, 'data:application/pdf;base64,QUJD')
    assert.deepEqual(done, { kind: 'pdf', name: 'doc.pdf', refText: '@file:doc.pdf', hint: '@file:doc.pdf' })
  })

  it('does not hide any other PDF failure behind the fallback', async () => {
    const c = client(() => {
      throw new JsonRpcGatewayError('PDF too large', { code: 4018 })
    })
    await assert.rejects(uploadAttachment(c.rpc, 'live1', { kind: 'pdf', name: 'doc.pdf', mime: 'application/pdf' }, 'QUJD'), /too large/)
    assert.equal(c.calls.length, 1)
  })

  it('stages any other file in the workspace and gets its reference', async () => {
    const c = client(() => ({ attached: true, name: 'notes.txt', path: '/w/notes.txt', ref_text: '@file:notes.txt', uploaded: true }))
    const done = await uploadAttachment(c.rpc, 'live1', { kind: 'file', name: 'notes.txt', mime: 'text/plain' }, 'QUJD')
    assert.deepEqual(c.calls[0], { method: 'file.attach', params: { session_id: 'live1', name: 'notes.txt', data_url: 'data:text/plain;base64,QUJD' } })
    assert.equal(done.refText, '@file:notes.txt')
  })
})

describe('the message', () => {
  const image: Uploaded = { kind: 'image', name: 'a.png', hint: '[User attached image: upload_1.png]' }
  const file: Uploaded = { kind: 'file', name: 'notes.txt', refText: '@file:notes.txt', hint: '@file:notes.txt' }

  it('puts file references before your words; pictures ride along on their own', () => {
    assert.equal(messageFor('What is in these?', [image, file]), '@file:notes.txt\nWhat is in these?')
    assert.equal(messageFor('  look  ', [image]), 'look')
  })

  it('is never empty: with no words it says what was attached', () => {
    assert.equal(messageFor('', [image]), '[User attached image: upload_1.png]')
    assert.equal(messageFor('   ', [image, file]), '[User attached image: upload_1.png]\n@file:notes.txt')
  })

  it('is just your words with nothing attached', () => {
    assert.equal(messageFor('hello', []), 'hello')
  })
})

describe('bubbles and bytes', () => {
  it('shows a thumbnail only for a picture', () => {
    assert.deepEqual(chipOf({ kind: 'image', name: '/x/a.png', uri: 'file:///x/a.png' }), { kind: 'image', name: 'a.png', uri: 'file:///x/a.png' })
    assert.deepEqual(chipOf({ kind: 'file', name: 'n.txt', uri: 'file:///n.txt' }), { kind: 'file', name: 'n.txt' })
  })

  it('encodes bytes as base64, including a large one', () => {
    assert.equal(bytesToBase64(new TextEncoder().encode('ABC')), 'QUJD')
    const big = new Uint8Array(100_000).fill(65)
    assert.equal(Buffer.from(bytesToBase64(big), 'base64').length, 100_000)
  })
})
