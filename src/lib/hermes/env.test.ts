import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { cleanValue, EnvError, isKeyLike, linkHost, listEnvKeys, looksRedacted, matchKeys, previewOf, removeEnvKey, saveEnvKey, setKeys, typedName, type EnvKey } from './env.ts'
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

const key = (partial: Partial<EnvKey> = {}): EnvKey => ({ name: 'XAI_API_KEY', isSet: false, preview: null, description: 'xAI API key', url: 'https://console.x.ai/', category: 'provider', secret: true, channel: false, custom: false, provider: 'xAI', ...partial })

/** A made-up key, standing in for a real one. */
const SECRET = 'xai-zz-test-0123456789abcdef'

describe('listEnvKeys', () => {
  it('asks for one bot’s keys and reads every row, never the value', async () => {
    answer({
      XAI_API_KEY: { is_set: true, redacted_value: '«redacted:xai-...cdef»', description: 'xAI   API key', url: 'https://console.x.ai/', category: 'provider', is_password: true, provider_label: 'xAI', channel_managed: false, custom: false },
      TELEGRAM_BOT_TOKEN: { is_set: false, redacted_value: null, description: 'Telegram', url: 'https://t.me/BotFather', category: 'messaging', is_password: true, channel_managed: true },
      MY_TOOL_TOKEN: { is_set: true, redacted_value: 'abcd...wxyz', category: 'custom', is_password: true, custom: true, url: 'javascript:alert(1)' },
      'not a name': { is_set: true },
      BROKEN: null,
    })
    const rows = await listEnvKeys(config, 'zz bot')

    assert.equal(calls[0]?.url, 'http://x/api/env?profile=zz%20bot')
    assert.equal(calls[0]?.init?.method, 'GET')
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['X-Hermes-Session-Token'], 't')
    assert.deepEqual(rows, [
      { name: 'XAI_API_KEY', isSet: true, preview: 'xai-...cdef', description: 'xAI API key', url: 'https://console.x.ai/', category: 'provider', secret: true, channel: false, custom: false, provider: 'xAI' },
      { name: 'TELEGRAM_BOT_TOKEN', isSet: false, preview: null, description: 'Telegram', url: 'https://t.me/BotFather', category: 'messaging', secret: true, channel: true, custom: false, provider: '' },
      { name: 'MY_TOOL_TOKEN', isSet: true, preview: 'abcd...wxyz', description: '', url: null, category: 'custom', secret: true, channel: false, custom: true, provider: '' },
    ])
  })

  it('copes with an answer that is not an object', async () => {
    answer(['x'])
    assert.deepEqual(await listEnvKeys(config, 'zz-a'), [])
  })

  it('says when the server has no such bot', async () => {
    answer({ detail: 'Profile \'zz-nope\' does not exist.' }, 404)
    await assert.rejects(listEnvKeys(config, 'zz-nope'), { name: 'EnvError', message: 'The server has no bot by this name.' })
  })

  it('turns a network failure into words that say nothing about the request', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Network request failed')
    }) as typeof fetch
    await assert.rejects(listEnvKeys(config, 'zz-a'), { message: 'Couldn’t reach the server.', status: null })
  })
})

describe('saveEnvKey', () => {
  it('sends the value once, in the body, for that bot only', async () => {
    answer({ ok: true, key: 'XAI_API_KEY', config_updates: [] })
    await saveEnvKey(config, 'zz-a', 'XAI_API_KEY', `  ${SECRET}\n`)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, 'http://x/api/env?profile=zz-a')
    assert.equal(calls[0]?.init?.method, 'PUT')
    assert.ok(!calls[0]?.url.includes(SECRET))
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { key: 'XAI_API_KEY', value: SECRET, profile: 'zz-a' })
  })

  it('never sends a preview, an empty value or a bad name', async () => {
    answer({ ok: true })

    for (const value of ['«redacted:xai-...cdef»', 'xai-...cdef', '***', '   ']) {
      await assert.rejects(saveEnvKey(config, 'zz-a', 'XAI_API_KEY', value), EnvError)
    }

    await assert.rejects(saveEnvKey(config, 'zz-a', '1BAD', SECRET), /letters, digits and _/)
    assert.equal(calls.length, 0)
  })

  it('shows the server’s reason for a refusal, cut to its first sentence', async () => {
    answer({ detail: 'Environment variable \'PATH\' is on the writer denylist. Names that influence subprocess execution (LD_PRELOAD, PATH, ...) cannot be persisted. Edit it directly.' }, 400)
    await assert.rejects(saveEnvKey(config, 'zz-a', 'PATH', '/tmp'), { status: 400, message: 'Environment variable \'PATH\' is on the writer denylist.' })
  })

  it('never puts the value in an error, even when the server echoes it', async () => {
    // FastAPI's 422 repeats the request body, value and all.
    answer({ detail: [{ type: 'missing', loc: ['body', 'value'], msg: 'Field required', input: { key: 'XAI_API_KEY', value: SECRET } }] }, 422)
    const unreadable = await saveEnvKey(config, 'zz-a', 'XAI_API_KEY', SECRET).catch((error: Error) => error)
    assert.ok(unreadable instanceof EnvError && !unreadable.message.includes(SECRET))

    answer({ detail: `Bad value ${SECRET}` }, 400)
    const echoed = await saveEnvKey(config, 'zz-a', 'XAI_API_KEY', SECRET).catch((error: Error) => error)
    assert.ok(echoed instanceof EnvError && !echoed.message.includes(SECRET))
    assert.equal(echoed.message, 'The server refused (400).')

    answer('Internal server error', 500)
    await assert.rejects(saveEnvKey(config, 'zz-a', 'XAI_API_KEY', SECRET), { message: 'The server ran into an error. Try again.' })
  })

  it('asks for a new sign-in on a 401', async () => {
    answer({ detail: 'Unauthorized' }, 401)
    await assert.rejects(saveEnvKey(config, 'zz-a', 'XAI_API_KEY', SECRET), { message: 'The server signed this app out. Sign in again.' })
  })
})

describe('removeEnvKey', () => {
  it('removes one key for that bot', async () => {
    answer({ ok: true, key: 'XAI_API_KEY', removed: true, found: true })
    assert.equal(await removeEnvKey(config, 'zz-a', 'XAI_API_KEY'), true)
    assert.equal(calls[0]?.url, 'http://x/api/env?profile=zz-a')
    assert.equal(calls[0]?.init?.method, 'DELETE')
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { key: 'XAI_API_KEY', profile: 'zz-a' })
  })

  it('reads a 404 for a key that was not there as already gone, and one for an unknown bot as an error', async () => {
    answer({ detail: 'XAI_API_KEY not found in .env' }, 404)
    assert.equal(await removeEnvKey(config, 'zz-a', 'XAI_API_KEY'), false)

    answer({ detail: 'Profile \'zz-nope\' does not exist.' }, 404)
    await assert.rejects(removeEnvKey(config, 'zz-nope', 'XAI_API_KEY'), { message: 'The server has no bot by this name.' })
  })
})

describe('values', () => {
  it('trims a pasted value and refuses what would not work', () => {
    assert.deepEqual(cleanValue(`\t${SECRET}\r\n`), { value: SECRET })
    assert.ok('error' in cleanValue(''))
    assert.ok('error' in cleanValue('«redacted-secret»'))
    // A Cyrillic "а" that looks like an "a", from a PDF.
    assert.ok('error' in cleanValue('x\u0430i-1234'))
  })

  it('knows Hermes’s previews by shape', () => {
    assert.equal(looksRedacted('«redacted:sk-a...wxyz»'), true)
    assert.equal(looksRedacted('sk-a...wxyz'), true)
    assert.equal(looksRedacted('***'), true)
    assert.equal(looksRedacted(SECRET), false)
    assert.equal(previewOf('«redacted:sk-a...wxyz»'), 'sk-a...wxyz')
    assert.equal(previewOf('sk-a...wxyz'), 'sk-a...wxyz')
    assert.equal(previewOf(null), null)
    assert.equal(previewOf('«redacted:»'), null)
  })
})

describe('the list', () => {
  it('lists what is set, keys first, settings apart, channel credentials left out', () => {
    const rows = [
      key({ name: 'XAI_API_KEY', isSet: true }),
      key({ name: 'ELEVENLABS_API_KEY', isSet: true, category: 'tool' }),
      key({ name: 'OPENAI_API_KEY', isSet: false }),
      key({ name: 'TELEGRAM_BOT_TOKEN', isSet: true, channel: true }),
      key({ name: 'OPENAI_BASE_URL', isSet: true, secret: false }),
      key({ name: 'GITHUB_PAT', isSet: true, custom: true }),
      key({ name: 'TERMINAL_TIMEOUT', isSet: true, custom: true }),
    ]
    const { keys, other } = setKeys(rows)

    assert.deepEqual(keys.map(row => row.name), ['ELEVENLABS_API_KEY', 'GITHUB_PAT', 'XAI_API_KEY'])
    assert.deepEqual(other.map(row => row.name), ['OPENAI_BASE_URL', 'TERMINAL_TIMEOUT'])
  })

  it('tells custom keys from custom settings by name', () => {
    for (const name of ['MY_API_KEY', 'SERVICE_TOKEN', 'APP_SECRET', 'DB_PASSWORD', 'GOOGLE_CREDENTIALS', 'OPENROUTERKEY']) {
      assert.equal(isKeyLike(key({ name, custom: true })), true, name)
    }

    for (const name of ['TERMINAL_TIMEOUT', 'WEB_TOOLS_DEBUG', 'BROWSER_SESSION_TIMEOUT', 'MONKEY_MODE']) {
      assert.equal(isKeyLike(key({ name, custom: true })), false, name)
    }
  })
})

describe('adding', () => {
  const rows = [
    key({ name: 'XAI_API_KEY' }),
    key({ name: 'ELEVENLABS_API_KEY', description: 'ElevenLabs API key for premium text-to-speech voices', provider: '' }),
    key({ name: 'OPENAI_API_KEY', description: 'OpenAI API', provider: 'OpenAI API' }),
    key({ name: 'FAL_KEY', description: 'FAL image generation', provider: '' }),
    key({ name: 'OPENAI_BASE_URL', description: 'OpenAI API base URL override', secret: false }),
    key({ name: 'TELEGRAM_BOT_TOKEN', description: 'Telegram bot token', channel: true }),
    key({ name: 'GROQ_API_KEY', description: 'Groq', isSet: true, provider: 'Groq' }),
    key({ name: 'MY_KEY', custom: true, isSet: true }),
  ]

  it('offers the known secrets that match, names that start with it first', () => {
    assert.deepEqual(matchKeys(rows, 'xai').map(row => row.name), ['XAI_API_KEY'])
    assert.deepEqual(matchKeys(rows, 'speech').map(row => row.name), ['ELEVENLABS_API_KEY'])
    assert.deepEqual(matchKeys(rows, 'api key').map(row => row.name), ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY'])
    assert.deepEqual(matchKeys(rows, 'openai').map(row => row.name), ['OPENAI_API_KEY'])
    assert.deepEqual(matchKeys(rows, 'api_key', 2).map(row => row.name), ['ELEVENLABS_API_KEY', 'OPENAI_API_KEY'])
    // Set, channel, custom and non-secret rows are never offered; nothing typed offers nothing.
    assert.deepEqual(matchKeys(rows, 'groq'), [])
    assert.deepEqual(matchKeys(rows, 'telegram'), [])
    assert.deepEqual(matchKeys(rows, '  '), [])
  })

  it('offers the exact name typed when the matches do not', () => {
    assert.deepEqual(typedName(rows, ' MY_SERVICE_TOKEN ', []), { name: 'MY_SERVICE_TOKEN', row: null })
    assert.equal(typedName(rows, 'XAI_API_KEY', matchKeys(rows, 'XAI_API_KEY')), null)
    assert.equal(typedName(rows, 'OPENAI_BASE_URL', [])?.row?.name, 'OPENAI_BASE_URL')
    assert.equal(typedName(rows, 'GROQ_API_KEY', [])?.row?.isSet, true)
    assert.equal(typedName(rows, 'TELEGRAM_BOT_TOKEN', []), null)
    assert.equal(typedName(rows, 'my key', []), null)
    assert.equal(typedName(rows, '9LIVES', []), null)
    // A lowercase word is a search, not a new name.
    assert.equal(typedName(rows, 'xai', []), null)
    assert.equal(typedName(rows, 'My_Key2', []), null)
  })

  it('names a docs link by its host', () => {
    assert.equal(linkHost('https://console.x.ai/'), 'console.x.ai')
    assert.equal(linkHost('https://elevenlabs.io/app/settings?tab=keys'), 'elevenlabs.io')
  })
})
