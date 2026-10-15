import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import { JsonRpcGatewayError, type GatewayEvent } from '../../lib/hermes/gateway-client.ts'
import type { DisplayLease, DisplayStatus } from '../../lib/hermes/protocol.ts'
import type { ServerRequestFrame } from '../../lib/hermes/server-requests.ts'
import { createDisplay, isMine, type Display } from './store.ts'

const lease = (over: Partial<DisplayLease> = {}): DisplayLease => ({ holder: 'agent', viewer_hash: null, since: 100, epoch: 1, reason: '', ...over })

const status = (over: Partial<DisplayStatus> = {}): DisplayStatus => ({
  profile: 'bot',
  supported: true,
  installed: true,
  missing: [],
  running: true,
  geometry: '1440x900',
  lease: lease(),
  profile_key: '~/.hermes/profiles/bot',
  ...over,
})

const hex = (text: string) => createHash('sha256').update(text).digest('hex')

function harness() {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {}
  const listeners = new Set<(event: GatewayEvent) => void>()
  const generation = { value: 1 }

  const display = createDisplay({
    client: {
      async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        calls.push({ method, params })
        const handler = handlers[method]

        if (!handler) {
          throw new JsonRpcGatewayError('method not found', { code: -32601 })
        }

        return (await handler(params)) as T
      },
    },
    onEvent: handler => (listeners.add(handler), () => void listeners.delete(handler)),
    getGeneration: () => generation.value,
    sha256Hex: async input => hex(input),
  })

  return {
    display,
    calls,
    handlers,
    generation,
    emit: (type: string, payload: unknown) => listeners.forEach(listener => listener({ type, payload } as GatewayEvent)),
    screen: (d: Display = display, profile = 'bot') => d.get(profile),
  }
}

const err5300 = (message: string, code?: string) => new JsonRpcGatewayError(message, { code: 5300, data: code ? { code } : undefined })

describe('reading a screen', () => {
  it('stores the status and marks the screen supported', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status()
    await h.display.refresh('bot')

    assert.equal(h.screen().support, 'yes')
    assert.equal(h.screen().status?.geometry, '1440x900')
    assert.deepEqual(h.calls[0], { method: 'display.status', params: { profile: 'bot' } })
  })

  it('a server with no Bot Screen (method not found) is "no", not an error', async () => {
    const h = harness()
    await h.display.refresh('bot')

    assert.equal(h.screen().support, 'no')
    assert.equal(h.screen().error, null)
  })

  it('any other failure is shown, and support stays unknown', async () => {
    const h = harness()
    h.handlers['display.status'] = () => {
      throw err5300('socket exploded')
    }
    await h.display.refresh('bot')

    assert.equal(h.screen().support, 'unknown')
    assert.equal(h.screen().error, 'socket exploded')
  })

  it('asks every bot', async () => {
    const h = harness()
    h.handlers['display.status'] = params => status({ profile: String(params.profile), profile_key: `~/${params.profile}` })
    await h.display.refreshAll(['a', 'b', 'c'])

    assert.deepEqual(h.calls.map(call => call.params.profile).sort(), ['a', 'b', 'c'])
    assert.equal(h.screen(h.display, 'b').status?.profile, 'b')
  })
})

describe('events', () => {
  it('a status event (a start or stop made elsewhere) replaces the status', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status({ running: false })
    await h.display.refresh('bot')
    h.emit('display.status', status({ running: true }))

    assert.equal(h.screen().status?.running, true)
  })

  it('a lease event finds its screen by profile_key and changes only the lease', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status()
    await h.display.refresh('bot')
    h.emit('display.lease', { profile_key: '~/.hermes/profiles/bot', lease: lease({ holder: 'human', viewer_hash: 'abc123', epoch: 2 }) })

    assert.equal(h.screen().status?.lease.holder, 'human')
    assert.equal(h.screen().status?.running, true)
  })

  it('a lease event for a screen we have never seen is ignored', () => {
    const h = harness()
    h.emit('display.lease', { profile_key: '~/somewhere/else', lease: lease({ holder: 'human' }) })

    assert.deepEqual(h.display.store.getState().screens, {})
  })
})

describe('start and stop', () => {
  it('start shows busy, then the running status', async () => {
    const h = harness()
    const seen: (string | null)[] = []
    h.display.store.subscribe(state => seen.push(state.screens.bot?.busy ?? null))
    h.handlers['display.start'] = () => status({ running: true })
    await h.display.start('bot')

    assert.ok(seen.includes('starting'))
    assert.equal(h.screen().busy, null)
    assert.equal(h.screen().status?.running, true)
  })

  it('a refused start says why and clears busy', async () => {
    const h = harness()
    h.handlers['display.start'] = () => {
      throw err5300('not enough memory')
    }
    await h.display.start('bot')

    assert.equal(h.screen().busy, null)
    assert.equal(h.screen().error, 'not enough memory')
  })

  it('stop is refused while a human holds it, unless forced', async () => {
    const h = harness()
    h.handlers['display.stop'] = params => {
      if (!params.force) throw err5300('a human holds this screen; pass force: true', 'viewer_mismatch')

      return { ...status({ running: false }), stopped: true }
    }
    await h.display.stop('bot')
    assert.match(h.screen().error ?? '', /human holds/)
    await h.display.stop('bot', true)

    assert.equal(h.screen().error, null)
    assert.equal(h.screen().status?.running, false)
    assert.deepEqual(h.calls.at(-1)?.params, { profile: 'bot', force: true })
  })
})

describe('thumbnails', () => {
  it('keeps the frame', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status()
    h.handlers['display.thumbnail'] = () => ({ data_url: 'data:image/jpeg;base64,AAA' })
    await h.display.refresh('bot')
    await h.display.thumbnail('bot')

    assert.equal(h.screen().thumbnail, 'data:image/jpeg;base64,AAA')
    assert.equal(h.screen().withheld, false)
  })

  it('while a human drives the server withholds the frame: the last one stays, and we say it is withheld', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status()
    let call = 0
    h.handlers['display.thumbnail'] = () => (call++ === 0 ? { data_url: 'data:image/jpeg;base64,AAA' } : { data_url: null, suppressed: 'human_has_control' })
    await h.display.refresh('bot')
    await h.display.thumbnail('bot')
    await h.display.thumbnail('bot')

    assert.equal(h.screen().thumbnail, 'data:image/jpeg;base64,AAA')
    assert.equal(h.screen().withheld, true)
  })

  it('does not ask for a frame of a screen that is off', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status({ running: false })
    await h.display.refresh('bot')
    await h.display.thumbnail('bot')

    assert.ok(!h.calls.some(entry => entry.method === 'display.thumbnail'))
  })

  it('a failed grab is not an error', async () => {
    const h = harness()
    h.handlers['display.status'] = () => status()
    h.handlers['display.thumbnail'] = () => {
      throw new Error('timeout')
    }
    await h.display.refresh('bot')
    await h.display.thumbnail('bot')

    assert.equal(h.screen().error, null)
  })
})

describe('the viewer id', () => {
  const observed = (id: string) => (): unknown => ({ ...status(), ticket: `t-${id}`, path: '/api/display/ws', viewer_id: id })

  it('is minted by observe, with the hash the lease will show', async () => {
    const h = harness()
    h.handlers['display.observe'] = observed('v1')
    const got = await h.display.observe('bot')

    assert.deepEqual(got, { ticket: 't-v1', path: '/api/display/ws', viewerId: 'v1' })
    assert.equal(h.screen().viewer?.hash, hex('v1').slice(0, 12))
  })

  it('is passed back on the same connection so it keeps its identity', async () => {
    const h = harness()
    h.handlers['display.observe'] = observed('v1')
    await h.display.observe('bot')
    await h.display.observe('bot')

    assert.equal(h.calls[0]?.params.viewer_id, undefined)
    assert.equal(h.calls[1]?.params.viewer_id, 'v1')
  })

  it('is NOT passed after a reconnect: the old one is dead and the server would mint a new one anyway', async () => {
    const h = harness()
    h.handlers['display.observe'] = observed('v1')
    await h.display.observe('bot')
    h.generation.value = 2
    h.handlers['display.observe'] = observed('v2')
    await h.display.observe('bot')

    assert.equal(h.calls[1]?.params.viewer_id, undefined)
    assert.equal(h.screen().viewer?.id, 'v2')
    assert.equal(h.screen().viewer?.generation, 2)
  })
})

describe('taking over and handing back', () => {
  async function ready() {
    const h = harness()
    h.handlers['display.status'] = () => status()
    h.handlers['display.observe'] = () => ({ ...status(), ticket: 't', path: '/api/display/ws', viewer_id: 'me' })
    await h.display.refresh('bot')

    return h
  }

  it('take over mints a viewer id first if needed, acquires with it, and then the lease is ours', async () => {
    const h = await ready()
    h.handlers['display.lease.acquire'] = () => ({ lease: lease({ holder: 'human', viewer_hash: hex('me').slice(0, 12), epoch: 2, reason: 'enter the code' }) })
    await h.display.takeOver('bot', 'enter the code')

    const acquire = h.calls.find(call => call.method === 'display.lease.acquire')
    assert.deepEqual(acquire?.params, { profile: 'bot', viewer_id: 'me', reason: 'enter the code' })
    assert.equal(isMine(h.screen().status?.lease, h.screen().viewer), true)
  })

  it('a lease held by someone else is not ours', async () => {
    const h = await ready()
    await h.display.observe('bot')
    h.emit('display.lease', { profile_key: '~/.hermes/profiles/bot', lease: lease({ holder: 'human', viewer_hash: 'somebody-else' }) })

    assert.equal(isMine(h.screen().status?.lease, h.screen().viewer), false)
  })

  it('hand back releases with our id, and the agent holds again', async () => {
    const h = await ready()
    await h.display.observe('bot')
    h.handlers['display.lease.release'] = () => ({ lease: lease({ epoch: 3 }) })
    await h.display.handBack('bot')

    assert.deepEqual(h.calls.at(-1)?.params, { profile: 'bot', viewer_id: 'me' })
    assert.equal(h.screen().status?.lease.holder, 'agent')
  })

  it('without a live viewer id (after a reconnect) a hand back must force, or the server refuses', async () => {
    const h = await ready()
    await h.display.observe('bot')
    h.generation.value = 2
    h.handlers['display.lease.release'] = () => ({ lease: lease() })
    await h.display.handBack('bot')

    assert.deepEqual(h.calls.at(-1)?.params, { profile: 'bot', force: true })
  })

  it('a refusal is shown and thrown, so the caller can stay in control mode', async () => {
    const h = await ready()
    h.handlers['display.lease.acquire'] = () => {
      throw err5300('viewer_id was not minted for this connection', 'viewer_mismatch')
    }

    await assert.rejects(h.display.takeOver('bot'))
    assert.match(h.screen().error ?? '', /not minted/)
  })
})

describe('installing the host packages', () => {
  async function ready() {
    const h = harness()
    h.handlers['display.status'] = () => status({ installed: false, missing: ['Xvnc'] })
    await h.display.refresh('bot')

    return h
  }

  it('starts the install and follows its output by profile_key', async () => {
    const h = await ready()
    h.handlers['display.install'] = () => ({ started: true, command: 'sudo apt-get install -y x', profile_key: '~/.hermes/profiles/bot' })
    await h.display.install('bot')
    h.emit('display.install.log', { profile_key: '~/.hermes/profiles/bot', line: 'Setting up xfwm4' })
    h.emit('display.install.log', { profile_key: '~/.hermes/profiles/bot', line: 'Setting up xfce4-panel' })

    assert.equal(h.screen().busy, 'installing')
    assert.deepEqual(h.screen().installLog, ['Setting up xfwm4', 'Setting up xfce4-panel'])
  })

  it('keeps only the tail of a long install', async () => {
    const h = await ready()
    h.handlers['display.install'] = () => ({ started: true, profile_key: '~/.hermes/profiles/bot' })
    await h.display.install('bot')
    for (let i = 0; i < 100; i++) h.emit('display.install.log', { profile_key: '~/.hermes/profiles/bot', line: `line ${i}` })

    assert.equal(h.screen().installLog.length, 40)
    assert.equal(h.screen().installLog.at(-1), 'line 99')
  })

  it('done with code 0 installs: busy clears and the new status arrives', async () => {
    const h = await ready()
    h.handlers['display.install'] = () => ({ started: true, profile_key: '~/.hermes/profiles/bot' })
    await h.display.install('bot')
    h.emit('display.install.done', { profile_key: '~/.hermes/profiles/bot', code: 0, status: status({ installed: true, missing: [], running: false }) })

    assert.equal(h.screen().busy, null)
    assert.equal(h.screen().error, null)
    assert.equal(h.screen().status?.installed, true)
  })

  it('done with -1 says it was cancelled, -2 says the host has no sudo, anything else says the exit code', async () => {
    for (const [code, text] of [[-1, /cancelled/], [-2, /no sudo/], [100, /exit 100/]] as const) {
      const h = await ready()
      h.handlers['display.install'] = () => ({ started: true, profile_key: '~/.hermes/profiles/bot' })
      await h.display.install('bot')
      h.emit('display.install.done', { profile_key: '~/.hermes/profiles/bot', code, status: status({ installed: false }) })

      assert.match(h.screen().error ?? '', text)
      assert.equal(h.screen().busy, null)
    }
  })

  it('a refused install (one is already running) clears busy and says so', async () => {
    const h = await ready()
    h.handlers['display.install'] = () => {
      throw err5300('an install is already running for this profile')
    }
    await h.display.install('bot')

    assert.equal(h.screen().busy, null)
    assert.match(h.screen().error ?? '', /already running/)
  })
})

describe('the install asking for a sudo password', () => {
  function withRequests() {
    const responses: { id: string | number; result: unknown }[] = []
    const listeners = new Set<(event: GatewayEvent) => void>()
    let ask: ((frame: ServerRequestFrame) => void) | undefined

    const display = createDisplay({
      client: { request: async <T>(method: string) => (method === 'display.status' ? (status({ installed: false }) as T) : (undefined as T)) },
      onEvent: handler => (listeners.add(handler), () => void listeners.delete(handler)),
      getGeneration: () => 1,
      sha256Hex: async input => hex(input),
      requests: { onRequest: (_method, handler) => ((ask = handler), () => undefined), respond: (id, result) => (responses.push({ id, result }), true) },
    })

    return {
      display,
      responses,
      ask: (frame: ServerRequestFrame) => ask?.(frame),
      emit: (type: string, payload: unknown) => listeners.forEach(listener => listener({ type, payload } as GatewayEvent)),
    }
  }

  const frame = (profileKey = '~/.hermes/profiles/bot'): ServerRequestFrame => ({ id: 'srq-1', method: 'display.install.sudo', params: { session_id: '', profile_key: profileKey } })

  it('holds the request and asks the person, then answers with what they typed', async () => {
    const { display, responses, ask } = withRequests()
    await display.refresh('bot')
    ask(frame())
    assert.equal(display.get('bot').needsSudo, true)

    assert.equal(display.answerSudo('bot', 'hunter2'), true)
    assert.deepEqual(responses, [{ id: 'srq-1', result: { value: 'hunter2' } }])
    assert.equal(display.get('bot').needsSudo, false)
    assert.ok(!JSON.stringify(display.store.getState()).includes('hunter2'), 'the password is not kept')
  })

  it('skipping answers with an empty value', async () => {
    const { display, responses, ask } = withRequests()
    await display.refresh('bot')
    ask(frame())
    display.answerSudo('bot', '')

    assert.deepEqual(responses, [{ id: 'srq-1', result: { value: '' } }])
  })

  it('an ask for an install this app did not start is declined at once', async () => {
    const { display, responses, ask } = withRequests()
    ask(frame('~/somewhere/else'))

    assert.deepEqual(responses, [{ id: 'srq-1', result: { value: '' } }])
    assert.equal(display.store.getState().screens.bot, undefined)
  })

  it('the server withdrawing the ask drops the password field', async () => {
    const { display, emit, ask } = withRequests()
    await display.refresh('bot')
    ask(frame())
    emit('request.cancel', { id: 'srq-1', method: 'display.install.sudo', reason: 'timeout' })

    assert.equal(display.get('bot').needsSudo, false)
    assert.equal(display.answerSudo('bot', 'late'), false)
  })

  it('with nothing to answer, answering says so', () => {
    const h = harness()
    assert.equal(h.display.answerSudo('bot', 'x'), false)
  })
})
