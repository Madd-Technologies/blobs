import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pluginView } from './view.ts'

describe('pluginView', () => {
  it('says checking until the first answer', () => {
    assert.deepEqual(pluginView('hermes-push', undefined, '0.2.0', true), { status: 'Checking…', lines: [], action: null })
  })

  it('offers the setup message when it is missing, and nothing to paste when it only needs turning on or a restart', () => {
    assert.equal(pluginView('hermes-push', { state: { kind: 'missing' } }, '0.2.0', false).action, 'install')

    const off = pluginView('hermes-push', { state: { kind: 'off', version: '0.2.0' } }, '0.2.0', false)
    assert.equal(off.action, null)
    assert.match(off.lines[0] ?? '', /hermes plugins enable hermes-push/)

    assert.deepEqual(pluginView('hermes-push', { state: { kind: 'restart', version: '0.2.0' } }, '0.2.0', false).status, 'Restart Hermes')
  })

  it('an older copy on the server is an update, with both versions named', () => {
    const view = pluginView('hermes-paperless', { state: { kind: 'ready', version: '0.1.0', update: true }, detail: 'Connected to Paperless at p:8000.' }, '0.2.0', false)
    assert.equal(view.status, 'Update available')
    assert.equal(view.action, 'update')
    assert.equal(view.lines[0], 'Connected to Paperless at p:8000.')
    assert.equal(view.lines[1], 'Your server has version 0.1.0; this app brings 0.2.0.')
  })

  it('answering but not set up offers the setup message; all good offers nothing', () => {
    assert.deepEqual(pluginView('hermes-paperless', { state: { kind: 'ready', version: '0.2.0', update: false }, detail: 'Not connected.', needsSetup: true }, '0.2.0', false), {
      status: 'Needs setup',
      lines: ['Not connected.'],
      action: 'install',
    })
    assert.deepEqual(pluginView('hermes-push', { state: { kind: 'ready', version: '0.2.0', update: false }, detail: '1 phone gets notifications.' }, '0.2.0', false), {
      status: 'On',
      lines: ['1 phone gets notifications.', 'Version 0.2.0.'],
      action: null,
    })
  })

  it('served by the plugin it replaces: an update, without comparing the two plugins’ versions', () => {
    const view = pluginView('hermes-bot-mobile', { state: { kind: 'ready', version: '0.2.0', update: true }, detail: '1 phone gets notifications. They come through the older hermes-push plugin.', formerly: true }, '0.1.0', false)
    assert.equal(view.status, 'Update available')
    assert.equal(view.action, 'update')
    assert.deepEqual(view.lines, ['1 phone gets notifications. They come through the older hermes-push plugin.'])
  })
})
