import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { getDriveStatus, getPaperlessStatus, type HubPlugin } from '../../lib/hermes/plugins.ts'
import type { ServerConfig } from '../../lib/hermes/server.ts'
import { checkPlugins, type Probed } from './check.ts'

const config: ServerConfig = { baseUrl: 'http://home-server:9119', auth: { kind: 'token', token: 't' } }

const PLUGINS: Probed[] = [
  { name: 'hermes-paperless', version: '0.3.0', probe: async server => ((await getPaperlessStatus(server)) ? { detail: 'Connected to Paperless.', needsSetup: false } : null) },
  { name: 'hermes-drive', version: '0.1.0', probe: async server => ((await getDriveStatus(server)) ? { detail: 'Connected to Drive.', needsSetup: false } : null) },
]

const HUB: HubPlugin[] = [
  { name: 'hermes-paperless', version: '0.2.0', runtime_status: 'enabled' },
  { name: 'hermes-drive', version: '0.1.0', runtime_status: 'enabled' },
]

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

/**
 * A server where the `loaded` plugins answer their status routes at once. Its hub is `absent` (404), `never` answers (until the
 * request is given up on, which goes in `log`), or answers these rows, when the promise settles.
 */
function serve(hub: 'absent' | 'never' | HubPlugin[] | Promise<HubPlugin[]>, loaded: string[], log: string[] = []) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('/api/dashboard/plugins/hub')) {
      if (hub === 'absent') {
        return json(404, { detail: 'Not Found' })
      }

      if (hub === 'never') {
        return new Promise<Response>((_, reject) =>
          init.signal?.addEventListener('abort', () => {
            log.push('hub given up')
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          }),
        )
      }

      return json(200, { plugins: await hub })
    }

    const plugin = /\/api\/plugins\/([^/]+)\/status$/.exec(url)?.[1] ?? ''

    return loaded.includes(plugin) ? json(200, { configured: true, drive: true, host: null, account: null }) : json(404, { detail: 'Not Found' })
  }) as typeof fetch
}

// A check that waits on the hub before its probes deadlocks the late-hub case: fail it rather than hang.
describe('checkPlugins', { timeout: 5000 }, () => {
  it('a hub that never answers holds up no plugin that answered', async () => {
    const log: string[] = []
    serve('never', ['hermes-paperless'], log)

    const checks = await checkPlugins(config, PLUGINS, { hubMs: 100, onCheck: name => log.push(`row ${name}`) })

    // Paperless was shown before the hub was given up on; Drive, silent, waited for it rather than guess.
    assert.deepEqual(log, ['row hermes-paperless', 'hub given up'])
    assert.deepEqual(checks['hermes-paperless'], { state: { kind: 'ready', version: null, update: false }, detail: 'Connected to Paperless.', needsSetup: false, formerly: undefined })
    assert.deepEqual(checks['hermes-drive']?.state, { kind: 'missing' })
  })

  it('a hub given up on reads the same as a server with no hub', async () => {
    serve('never', ['hermes-paperless'])
    const givenUp = await checkPlugins(config, PLUGINS, { hubMs: 100 })

    serve('absent', ['hermes-paperless'])
    const none = await checkPlugins(config, PLUGINS)

    assert.deepEqual(givenUp, none)
  })

  it('a hub that answers late still adds versions and tells a restart from missing', async () => {
    const log: string[] = []
    let answerHub = () => {}
    serve(
      new Promise<HubPlugin[]>(resolve => (answerHub = () => resolve(HUB))),
      ['hermes-paperless'],
    )

    const checks = await checkPlugins(config, PLUGINS, {
      onCheck: (name, check) => {
        log.push(`${name} ${check.state.kind}`)
        answerHub()
      },
    })

    assert.deepEqual(log, ['hermes-paperless ready'])
    assert.deepEqual(checks['hermes-paperless']?.state, { kind: 'ready', version: '0.2.0', update: true })
    assert.deepEqual(checks['hermes-drive']?.state, { kind: 'restart', version: '0.1.0' })
  })
})
