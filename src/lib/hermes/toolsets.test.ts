import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { listToolsets, setToolset, toolsetDetail, toolsetsLine, type Toolset } from './toolsets.ts'
import type { ServerConfig } from './server.ts'

const config: ServerConfig = { baseUrl: 'http://x', auth: { kind: 'token', token: 't' } }
const real = globalThis.fetch
const calls: { url: string; init?: RequestInit }[] = []

function answer(body: unknown, status = 200) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })

    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = real
  calls.length = 0
})

const row = (partial: Partial<Toolset> = {}): Toolset => ({ name: 'web', label: 'Web search', description: 'Search the web', platform: 'cli', platformLabel: 'CLI', enabled: true, configured: true, toolCount: 3, ...partial })

describe('listToolsets', () => {
  it('asks for one bot’s toolsets and reads the rows', async () => {
    answer([{ name: 'web', label: 'Web Search', description: 'Search', platform: 'cli', platform_label: 'CLI', enabled: true, configured: false, tools: ['a', 'b'] }, { name: 'tts', enabled: false }, { label: 'no name' }])
    const rows = await listToolsets(config, 'zz bot')

    assert.equal(calls[0]?.url, 'http://x/api/tools/toolsets?profile=zz%20bot')
    assert.deepEqual(rows, [
      { name: 'web', label: 'Web Search', description: 'Search', platform: 'cli', platformLabel: 'CLI', enabled: true, configured: false, toolCount: 2 },
      { name: 'tts', label: 'tts', description: '', platform: 'cli', platformLabel: '', enabled: false, configured: true, toolCount: 0 },
    ])
  })

  it('copes with an answer that is not a list', async () => {
    answer({ error: 'x' })
    assert.deepEqual(await listToolsets(config, 'a'), [])
  })
})

describe('setToolset', () => {
  it('writes the switch for that bot only: the profile is in the path and in the body', async () => {
    answer({ ok: true })
    await setToolset(config, 'zz-a', 'web', false)

    assert.equal(calls[0]?.url, 'http://x/api/tools/toolsets/web?profile=zz-a')
    assert.equal(calls[0]?.init?.method, 'PUT')
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { enabled: false, profile: 'zz-a' })
  })

  it('throws when the server refuses', async () => {
    answer({ detail: 'Unknown toolset: nope' }, 400)
    await assert.rejects(setToolset(config, 'zz-a', 'nope', true), /400/)
  })
})

describe('describing', () => {
  it('counts what is on', () => {
    assert.equal(toolsetsLine([row(), row({ enabled: false }), row()]), '2 of 3 on')
    assert.equal(toolsetsLine([]), '')
  })

  it('says what a toolset is for, how many tools it holds, and where it lives', () => {
    assert.equal(toolsetDetail(row()), 'Search the web · 3 tools')
    assert.equal(toolsetDetail(row({ toolCount: 1, description: '  Spaced \n out ' })), 'Spaced out · 1 tool')
    assert.equal(toolsetDetail(row({ platform: 'discord', platformLabel: 'Discord', toolCount: 0 })), 'Search the web · for Discord')
    assert.equal(toolsetDetail(row({ description: '', toolCount: 0 })), '')
  })
})
