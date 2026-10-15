import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { sanitizeText, sanitizeValue } from './sanitize.ts'

describe('sanitizeText', () => {
  it('replaces home directories with ~', () => {
    assert.equal(sanitizeText('/Users/alex/.hermes/profiles/x'), '~/.hermes/profiles/x')
    assert.equal(sanitizeText('cwd=/home/ubuntu/project'), 'cwd=~/project')
  })

  it('normalizes macOS temp roots', () => {
    assert.equal(sanitizeText('/var/folders/ab/cdefgh012345/T/hermesbot-smoke-cwd-AbC123'), '/tmp/hermesbot-smoke-cwd-AbC123')
  })

  it('redacts tokens in URLs and bearer headers', () => {
    assert.equal(sanitizeText('ws://h/api/ws?token=abc123&x=1'), 'ws://h/api/ws?token=<redacted>&x=1')
    assert.equal(sanitizeText('display_ticket=zzz'), 'display_ticket=<redacted>')
    assert.equal(sanitizeText('Authorization: Bearer abcdef1234567890'), 'Authorization: Bearer <redacted>')
  })

  it('leaves ordinary text alone', () => {
    assert.equal(sanitizeText('rm -r /tmp/hermesbot-smoke-1'), 'rm -r /tmp/hermesbot-smoke-1')
  })
})

describe('sanitizeValue', () => {
  it('scrubs nested strings and credential-named keys', () => {
    const out = sanitizeValue({ path: '/Users/alex/.hermes', nested: { access_token: 'secret-value', ok: 1 } })
    assert.deepEqual(out, { path: '~/.hermes', nested: { access_token: '<redacted>', ok: 1 } })
  })
})
