import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { openableLink } from './safe.ts'

describe('openableLink', () => {
  it('opens web pages, mails, calls and texts', () => {
    assert.equal(openableLink(' https://example.com/a?b=c '), 'https://example.com/a?b=c')
    assert.equal(openableLink('http://100.64.0.1:9119/'), 'http://100.64.0.1:9119/')
    assert.equal(openableLink('mailto:alex@example.com?subject=Hi'), 'mailto:alex@example.com?subject=Hi')
    assert.equal(openableLink('tel:+1 (555) 010-0100'), 'tel:+1 (555) 010-0100')
    assert.equal(openableLink('sms:+15550100100'), 'sms:+15550100100')
  })

  it('refuses the app’s own routes, so a link can never answer an approval', () => {
    assert.equal(openableLink('hermesbot://phone/answer?call=c1&choice=allow'), null)
    assert.equal(openableLink('HermesBot://bot/orion'), null)
  })

  it('refuses every other scheme', () => {
    for (const href of ['javascript:alert(1)', 'file:///etc/hosts', 'data:text/html,hi', 'intent://scan#Intent;end', 'googlegmail:///co', 'ftp://example.com', 'about:blank', '']) {
      assert.equal(openableLink(href), null, href)
    }
  })

  it('refuses a link with a space inside, which no tap target should carry', () => {
    assert.equal(openableLink('https://example.com/a b'), null)
  })
})
