import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SEALED_CSP, sealedDocument } from './sealed.ts'

describe('a sealed HTML draft', () => {
  it('runs nothing and loads nothing', () => {
    for (const rule of ["default-src 'none'", "script-src 'none'", "img-src 'none'", "frame-src 'none'", "form-action 'none'", "connect-src 'none'", "base-uri 'none'"]) {
      assert.ok(SEALED_CSP.includes(rule), rule)
    }
    assert.ok(!SEALED_CSP.includes('unsafe-eval'))
  })

  it('puts the policy before the draft, whose bytes are kept', () => {
    const html = '<p>Hi Dana,</p><script>alert(1)</script>'
    const page = sealedDocument(html)
    assert.ok(page.indexOf('Content-Security-Policy') < page.indexOf(html))
    assert.ok(page.includes(html))
  })
})
