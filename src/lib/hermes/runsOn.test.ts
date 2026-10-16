import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { checkLine, checkRunsOn, detailOf, sshOnServer, runsOnChange, runsOnKey, runsOnLabel, runsOnOf, splitAddress, targetProblem, type RunsOn } from './runsOn.ts'
import type { ServerConfig } from './server.ts'

const local = runsOnOf({ terminal: { backend: 'local', cwd: '/home/agent/work' } })

describe('reading where a bot runs', () => {
  it('reads each kind from the terminal section', () => {
    assert.equal(runsOnOf({ terminal: { backend: 'docker' } }).kind, 'docker')
    const ssh = runsOnOf({ terminal: { backend: 'SSH', ssh_host: 'vps-1.example.net', ssh_user: 'scout', ssh_port: '2222', ssh_key: '/srv/keys/id' } })
    assert.deepEqual(ssh, { kind: 'ssh', backend: 'ssh', host: 'vps-1.example.net', user: 'scout', port: 2222, key: '/srv/keys/id', cwd: '', fromServer: false })
  })

  it('treats a missing or odd config as this computer, and a cloud sandbox as other', () => {
    assert.equal(runsOnOf(undefined).kind, 'local')
    assert.equal(runsOnOf({ terminal: 'nonsense' }).kind, 'local')
    assert.equal(runsOnOf({ terminal: { backend: 'ssh', ssh_port: 'x' } }).port, 22)
    assert.deepEqual([runsOnOf({ terminal: { backend: 'modal' } }).kind, runsOnOf({ terminal: { backend: 'modal' } }).backend], ['other', 'modal'])
  })

  it('marks SSH whose address is kept in the server\'s .env', () => {
    const fromEnv = runsOnOf({ terminal: { backend: 'ssh' } })
    assert.equal(fromEnv.fromServer, true)
    assert.equal(runsOnLabel(fromEnv), 'Another computer')
    assert.equal(runsOnLabel({ ...fromEnv, serverTarget: 'ops@build-box' }), 'build-box over SSH')
    assert.equal(runsOnOf({ terminal: { backend: 'local' } }).fromServer, false)
  })

  it('names it for the Details row', () => {
    assert.equal(runsOnLabel(local), 'This computer')
    assert.equal(runsOnLabel(runsOnOf({ terminal: { backend: 'docker' } })), 'A container')
    assert.equal(runsOnLabel(runsOnOf({ terminal: { backend: 'ssh', ssh_host: 'vps-1' } })), 'vps-1 over SSH')
    assert.equal(runsOnLabel(runsOnOf({ terminal: { backend: 'ssh' } })), 'Another computer')
    assert.equal(runsOnLabel(runsOnOf({ terminal: { backend: 'vercel_sandbox' } })), 'Vercel Sandbox')
    assert.equal(runsOnLabel(runsOnOf({ terminal: { backend: 'my-plugin' } })), 'my-plugin')
  })
})

describe('changing it', () => {
  const target = { host: ' vps-1 ', user: 'scout ', port: 22, key: '/root/.hermes/profiles/scout/.ssh/runs_on_ed25519' }

  it('writes only the backend for this computer or a container', () => {
    assert.deepEqual(runsOnChange(local, 'docker'), { terminal: { backend: 'docker' } })
    assert.deepEqual(runsOnChange(local, 'local'), { terminal: { backend: 'local' } })
  })

  it('writes the whole target for another computer, and moves a host folder to its home', () => {
    assert.deepEqual(runsOnChange(local, 'ssh', target), {
      terminal: { backend: 'ssh', ssh_host: 'vps-1', ssh_user: 'scout', ssh_port: 22, ssh_key: target.key, cwd: '~' },
    })
  })

  it('keeps a folder that already belongs to the other computer, or none', () => {
    const remote: RunsOn = { ...runsOnOf({ terminal: { backend: 'ssh', cwd: '/srv/app' } }) }
    assert.equal(runsOnChange(remote, 'ssh', target).terminal.cwd, undefined)
    assert.equal(runsOnChange(runsOnOf({ terminal: { cwd: '~/work' } }), 'ssh', target).terminal.cwd, undefined)
    assert.equal(runsOnChange(runsOnOf({ terminal: { cwd: '.' } }), 'ssh', target).terminal.cwd, undefined)
    assert.equal(runsOnChange(runsOnOf({}), 'ssh', target).terminal.cwd, undefined)
  })

  it('leaves a blank key out, so a key in the server\'s .env still applies', () => {
    const change = runsOnChange(local, 'ssh', { ...target, key: ' ' })
    assert.equal('ssh_key' in change.terminal, false)
  })

  it('needs a target for another computer', () => {
    assert.throws(() => runsOnChange(local, 'ssh'))
  })
})

describe('the SSH form', () => {
  it('says what is wrong before anything is sent', () => {
    assert.equal(targetProblem({ host: 'vps-1.example.net', user: 'scout', port: 22 }), null)
    assert.equal(targetProblem({ host: '[fd7a:115c::1]', user: 'root', port: 2222 }), null)
    assert.match(targetProblem({ host: '', user: 'scout', port: 22 }) ?? '', /address/)
    assert.match(targetProblem({ host: '-oProxyCommand=id', user: 'scout', port: 22 }) ?? '', /characters/)
    assert.match(targetProblem({ host: 'vps', user: '', port: 22 }) ?? '', /user/)
    assert.match(targetProblem({ host: 'vps', user: 'a b', port: 22 }) ?? '', /user name/)
    assert.match(targetProblem({ host: 'vps', user: 'scout', port: 70000 }) ?? '', /port/)
    assert.match(targetProblem({ host: 'vps', user: 'scout', port: NaN }) ?? '', /port/)
  })

  it('splits a pasted user@host:port', () => {
    assert.deepEqual(splitAddress('scout@vps-1.example.net:2222'), { host: 'vps-1.example.net', user: 'scout', port: 2222 })
    assert.deepEqual(splitAddress('ssh://root@[fd7a::1]:22'), { host: 'fd7a::1', user: 'root', port: 22 })
    assert.deepEqual(splitAddress(' 100.64.0.7 '), { host: '100.64.0.7' })
    assert.deepEqual(splitAddress('fd7a:115c::1'), { host: 'fd7a:115c::1' })
  })

  it('explains what a check found', () => {
    const target = { host: 'vps-1', user: 'scout', port: 2222 }
    assert.equal(checkLine({ ok: true, system: 'Linux 6.8.0 x86_64' }, target), 'Connected · Linux 6.8.0 x86_64')
    assert.match(checkLine({ ok: false, reason: 'auth' }, target), /authorized_keys for scout/)
    assert.match(checkLine({ ok: false, reason: 'refused' }, target), /port 2222/)
    assert.match(checkLine({ ok: false, reason: 'too_many_keys' }, target), /MaxAuthTries/)
    assert.match(checkLine({ ok: false, reason: 'docker_down' }, target), /isn’t running/)
    assert.equal(checkLine({ ok: false, reason: 'other', detail: 'kex reset' }, target), 'Couldn’t connect: kex reset')
  })
})

describe('the plugin routes', () => {
  const config = { baseUrl: 'http://server', auth: { kind: 'token', token: 't' } } as ServerConfig
  const realFetch = globalThis.fetch
  const sent: { url: string; init: RequestInit | undefined }[] = []

  afterEach(() => {
    globalThis.fetch = realFetch
    sent.length = 0
  })

  function answer(status: number, body: unknown) {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, init })

      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
  }

  it('reads the key, and an older plugin as null', async () => {
    answer(200, { public: null, path: '/h/profiles/scout/.ssh/runs_on_ed25519' })
    assert.deepEqual(await runsOnKey(config, 'scout'), { public: null, path: '/h/profiles/scout/.ssh/runs_on_ed25519' })
    assert.equal(sent[0]?.url, 'http://server/api/plugins/hermes-bot-mobile/runs-on/key?profile=scout')

    answer(404, { detail: 'Not Found' })
    assert.equal(await runsOnKey(config, 'scout'), null)

    answer(404, { detail: 'No bot called scout on this server.' })
    await assert.rejects(runsOnKey(config, 'scout'))
  })

  it('shows the plugin\'s own words when it refuses', async () => {
    answer(422, { detail: 'That is not a computer\'s address.' })
    const error = await checkRunsOn(config, 'scout', 'ssh', { host: 'x', user: 'y', port: 22, key: '' }).catch((failure: unknown) => failure)
    assert.equal(detailOf(error), 'That is not a computer\'s address.')
    assert.equal(detailOf(new Error('boom')), null)
  })

  it('reads an SSH address kept in the server\'s .env from the backends route', async () => {
    answer(200, { active: 'ssh', backends: [{ name: 'local', status: 'ready', detail: '' }, { name: 'ssh', status: 'ready', detail: 'ops@build-box' }] })
    assert.equal(await sshOnServer(config, 'scout'), 'ops@build-box')
    assert.equal(sent[0]?.url, 'http://server/api/tools/terminal/backends?profile=scout')

    answer(200, { backends: [{ name: 'ssh', status: 'needs_setup', detail: 'Set terminal.ssh_host in config.yaml' }] })
    assert.equal(await sshOnServer(config, 'scout'), undefined)

    answer(404, { detail: 'Not Found' })
    assert.equal(await sshOnServer(config, 'scout'), undefined)
  })

  it('sends a trimmed target to the check', async () => {
    answer(200, { ok: true, system: 'Linux' })
    await checkRunsOn(config, 'scout', 'ssh', { host: ' vps-1 ', user: 'scout', port: 22, key: '' })
    assert.deepEqual(JSON.parse(String(sent[0]?.init?.body)), { profile: 'scout', backend: 'ssh', host: 'vps-1', user: 'scout', port: 22, key: '' })
  })
})
