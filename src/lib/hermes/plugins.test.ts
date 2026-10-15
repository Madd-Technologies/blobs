import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compareVersions, isAbsent, pluginState, type HubPlugin } from './plugins.ts'
import { HermesHttpError } from './server.ts'

const hub = (rows: Partial<HubPlugin>[]): HubPlugin[] => rows.map(row => ({ name: 'hermes-push', version: '0.2.0', runtime_status: 'enabled', ...row }))

describe('compareVersions', () => {
  it('compares dotted numbers as numbers', () => {
    assert.equal(compareVersions('0.10.0', '0.9.2'), 1)
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
    assert.equal(compareVersions('1.0', '1.0.0'), 0)
    assert.equal(compareVersions('0.2.0+local', '0.2.0'), 0)
  })
})

describe('pluginState', () => {
  it('a plugin that answers is ready, and older than the app’s copy is an update', () => {
    assert.deepEqual(pluginState('hermes-push', hub([{ version: '0.2.0' }]), true, '0.2.0'), { kind: 'ready', version: '0.2.0', update: false })
    assert.deepEqual(pluginState('hermes-push', hub([{ version: '0.1.0' }]), true, '0.2.0'), { kind: 'ready', version: '0.1.0', update: true })
    assert.deepEqual(pluginState('hermes-push', hub([{ version: '0.3.0' }]), true, '0.2.0'), { kind: 'ready', version: '0.3.0', update: false })
  })

  it('without the hub, a plugin that answers is ready with no version and no update claimed', () => {
    assert.deepEqual(pluginState('hermes-push', null, true, '0.2.0'), { kind: 'ready', version: null, update: false })
  })

  it('installed but silent: on means restart Hermes, otherwise it is off', () => {
    assert.deepEqual(pluginState('hermes-push', hub([{ runtime_status: 'enabled' }]), false, '0.2.0'), { kind: 'restart', version: '0.2.0' })
    assert.deepEqual(pluginState('hermes-push', hub([{ runtime_status: 'inactive' }]), false, '0.2.0'), { kind: 'off', version: '0.2.0' })
    assert.deepEqual(pluginState('hermes-push', hub([{ runtime_status: 'disabled' }]), false, '0.2.0'), { kind: 'off', version: '0.2.0' })
  })

  it('not in the folder, or no hub and no answer, is missing', () => {
    assert.deepEqual(pluginState('hermes-push', hub([{ name: 'kanban' }]), false, '0.2.0'), { kind: 'missing' })
    assert.deepEqual(pluginState('hermes-push', null, false, '0.2.0'), { kind: 'missing' })
  })
})

describe('isAbsent', () => {
  it('a 404 or the web app’s HTML means the route is not there; other failures are real', () => {
    assert.equal(isAbsent(new HermesHttpError(404, 'x')), true)
    assert.equal(isAbsent(new SyntaxError('Unexpected token <')), true)
    assert.equal(isAbsent(new HermesHttpError(500, 'x')), false)
    assert.equal(isAbsent(new Error('Network request failed')), false)
  })
})
