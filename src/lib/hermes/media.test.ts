import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fetchPicture, imageOfResult, isPicture, isRemote, splitMedia, viewError } from './media.ts'
import { HermesHttpError, type ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'https://h.ts.net', auth: { kind: 'oauth', accessToken: 'tok', refreshToken: 'r', expiresAt: 0 } }
const realFetch = globalThis.fetch

function answer(handler: (url: string) => { status?: number; body?: unknown }) {
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(url)
    const { status = 200, body } = handler(url)

    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch

  return urls
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('MEDIA lines in a bot’s reply', () => {
  it('lifts them out of the text and keeps the words', () => {
    const { text, media } = splitMedia('Here is the chart.\nMEDIA:/home/orion/.hermes/images/chart.png\nLet me know.')
    assert.equal(text, 'Here is the chart.\nLet me know.')
    assert.deepEqual(media, [{ path: '/home/orion/.hermes/images/chart.png', name: 'chart.png' }])
  })

  it('reads several, once each, and quoted ones', () => {
    const { text, media } = splitMedia('MEDIA:/a/one.png\n`MEDIA:/a/two.jpg`\nMEDIA:/a/one.png\nDone.')
    assert.equal(text, 'Done.')
    assert.deepEqual(media.map(item => item.name), ['one.png', 'two.jpg'])
  })

  it('leaves a reply with no media exactly as it was', () => {
    const reply = 'No pictures.\n\n\nJust words.'
    assert.deepEqual(splitMedia(reply), { text: reply, media: [] })
  })

  it('does not take the word MEDIA from the middle of a sentence', () => {
    assert.deepEqual(splitMedia('Save it to MEDIA:/x.png for later').media, [])
  })

  it('knows a picture by its extension', () => {
    assert.equal(isPicture('/a/b.PNG'), true)
    assert.equal(isPicture('/a/b.jpeg'), true)
    assert.equal(isPicture('/a/b.pdf'), false)
  })
})

describe('picture paths a bot states in its words', () => {
  const PATH = '/home/orion/.hermes/profiles/zz-pics/images/green-triangle.png'

  it('draws a picture whose path is a line of its own, and drops that line', () => {
    assert.deepEqual(splitMedia(`Red — a solid fill.\n\nGreen triangle on white:\n\n${PATH}`), {
      text: 'Red — a solid fill.\n\nGreen triangle on white:',
      media: [{ path: PATH, name: 'green-triangle.png', stated: true }],
    })
  })

  it('also takes a path in backticks, quotes, a bullet or with a full stop, on its own line', () => {
    for (const line of [`\`${PATH}\``, `"${PATH}"`, `- ${PATH}`, `${PATH}.`, `* \`${PATH}\``]) {
      assert.deepEqual(splitMedia(`Here:\n${line}`).media, [{ path: PATH, name: 'green-triangle.png', stated: true }], line)
      assert.equal(splitMedia(`Here:\n${line}`).text, 'Here:', line)
    }
  })

  it('draws a picture from a path inside a sentence but leaves the sentence as it is', () => {
    const text = `I saved it to ${PATH} for you.`

    assert.deepEqual(splitMedia(text), { text, media: [{ path: PATH, name: 'green-triangle.png', stated: true }] })
  })

  it('takes a path in backticks or a markdown link inside a sentence', () => {
    assert.equal(splitMedia(`See \`${PATH}\` now`).media.length, 1)
    assert.equal(splitMedia(`![triangle](${PATH})`).media.length, 1)
  })

  it('does not take web addresses, relative paths, other files or half of a longer word', () => {
    for (const text of ['https://example.com/a/b.png', 'see images/a.png', 'docs at /home/orion/notes.txt', 'foo/home/orion/a.png', 'a file called x.png', 'ratio 1/2.png']) {
      assert.deepEqual(splitMedia(text).media, [], text)
    }
  })

  it('gives every picture once, after the MEDIA ones, and no more than six', () => {
    const many = Array.from({ length: 9 }, (_, i) => `/p/${i}.png`).join('\n')

    assert.equal(splitMedia(many).media.length, 6)
    assert.deepEqual(splitMedia(`MEDIA:${PATH}\n${PATH}\nsee ${PATH}`).media, [{ path: PATH, name: 'green-triangle.png' }])
  })

  it('leaves out a picture a tool already drew, along with the line that only said where it was', () => {
    assert.deepEqual(splitMedia(`Here you go.\n${PATH}`, new Set([PATH])), { text: 'Here you go.', media: [] })
    assert.deepEqual(splitMedia(`Here you go.\nMEDIA:${PATH}`, new Set([PATH])), { text: 'Here you go.', media: [] })
    assert.deepEqual(splitMedia(`I saved it to ${PATH}.`, new Set([PATH])).media, [])
  })
})

describe('the picture an image tool made', () => {
  it('takes the file the server can read, then the address', () => {
    assert.equal(imageOfResult({ success: true, host_image: '/h/a.png', image: 'https://x/a.png' }), '/h/a.png')
    assert.equal(imageOfResult({ success: true, image: 'https://x/a.png' }), 'https://x/a.png')
    assert.equal(imageOfResult('{"success":true,"image":"/h/b.png"}'), '/h/b.png')
  })

  it('takes nothing from a failed run, a missing or odd field, or text that is not JSON', () => {
    assert.equal(imageOfResult({ success: false, image: '/h/a.png' }), undefined)
    assert.equal(imageOfResult({ success: true, image: null }), undefined)
    assert.equal(imageOfResult({ success: true, image: 'not a path' }), undefined)
    assert.equal(imageOfResult('plain output'), undefined)
    assert.equal(imageOfResult(undefined), undefined)
    assert.equal(imageOfResult([1]), undefined)
  })

  it('knows a web address from a file', () => {
    assert.equal(isRemote('https://x/a.png'), true)
    assert.equal(isRemote('/home/a.png'), false)
  })
})

describe('fetching a picture', () => {
  it('reads it from the server’s files, in the bot’s scope', async () => {
    const urls = answer(() => ({ body: { dataUrl: 'data:image/png;base64,AAA' } }))
    assert.equal(await fetchPicture(config, '/h/profiles/zz/images/a b.png', 'zz'), 'data:image/png;base64,AAA')
    assert.equal(urls[0], 'https://h.ts.net/api/fs/read-data-url?path=%2Fh%2Fprofiles%2Fzz%2Fimages%2Fa%20b.png&profile=zz')
  })

  it('falls back to the media route when the file route will not serve it', async () => {
    const urls = answer(url => (url.includes('/api/fs/') ? { status: 403, body: {} } : { body: { data_url: 'data:image/png;base64,BBB' } }))
    assert.equal(await fetchPicture(config, '/h/images/a.png'), 'data:image/png;base64,BBB')
    assert.equal(urls.length, 2)
    assert.match(urls[1] ?? '', /\/api\/media\?path=/)
  })

  it('does not try again when the file is gone or too large', async () => {
    const urls = answer(() => ({ status: 404, body: {} }))
    await assert.rejects(fetchPicture(config, '/h/images/a.png'), error => error instanceof HermesHttpError && error.status === 404)
    assert.equal(urls.length, 1)
  })

  it('says what went wrong in words', () => {
    assert.match(viewError(new HermesHttpError(413, 'x')), /too large/)
    assert.match(viewError(new HermesHttpError(404, 'x')), /no longer/)
    assert.match(viewError(new HermesHttpError(403, 'x')), /will not open/)
    assert.equal(viewError(new Error('Network request failed')), 'Network request failed')
  })
})
