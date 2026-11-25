import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseConnectQr } from './qr.ts'

describe('parseConnectQr', () => {
  it('parses hermesbot://connect deep links with optional token and label', () => {
    const parsed = parseConnectQr('hermesbot://connect?url=https%3A%2F%2Fhome-server.ts.net%2F&token=abc123&label=Home')
    assert.deepEqual(parsed, { url: 'https://home-server.ts.net', token: 'abc123', label: 'Home' })
  })

  it('parses plain http and https URLs', () => {
    assert.deepEqual(parseConnectQr('https://home-server.ts.net/'), { url: 'https://home-server.ts.net' })
    assert.deepEqual(parseConnectQr('http://100.64.0.1:9119'), { url: 'http://100.64.0.1:9119' })
  })

  it('rejects non-connect deep links and unsafe schemes', () => {
    assert.equal(parseConnectQr('hermesbot://phone/answer?approved=1'), null)
    assert.equal(parseConnectQr('hermesbot://connect?url=javascript:alert(1)'), null)
    assert.equal(parseConnectQr('javascript:alert(1)'), null)
    assert.equal(parseConnectQr('file:///etc/passwd'), null)
    assert.equal(parseConnectQr('not a url'), null)
  })
})
