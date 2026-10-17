import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { APPROVAL_MODES, approvalModeOf, BOT_NAME, browserHeadedOf, changeModel, disabledSkills, modelSections, uniqueSkills, withSkill, createBot, isProtectedProfile, mergeBotMeta, MetaConflictError, slugifyName, updateBotMeta, chatModelDiffers } from './profiles.ts'
import type { ModelOptions, ProfileRow } from './protocol.ts'
import type { RpcClient } from './rpc.ts'

function fakeClient(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  const client: RpcClient = {
    async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params })
      const handler = handlers[method]

      if (!handler) {
        throw new Error(`unscripted ${method}`)
      }

      return (await handler(params)) as T
    },
  }

  return { client, calls }
}

const row = (meta: Record<string, unknown> | undefined, revision?: number): ProfileRow =>
  ({ name: 'bot', ui_meta: meta ? { 'hermes-bots': meta } : undefined, ui_meta_revisions: revision === undefined ? {} : { 'hermes-bots': revision } }) as unknown as ProfileRow

describe('names', () => {
  it('turns a display name into a profile name', () => {
    assert.equal(slugifyName('Date night!'), 'date-night')
    assert.equal(slugifyName('  Café Müller  '), 'cafe-muller')
    assert.equal(slugifyName('Ops / Infra_2'), 'ops-infra-2')
    assert.equal(slugifyName('!!!'), '')
  })

  it('keeps it within what the server accepts', () => {
    const long = slugifyName('a'.repeat(100))
    assert.equal(long.length, 64)
    assert.ok(BOT_NAME.test(long))
    assert.ok(BOT_NAME.test(slugifyName(`${'word '.repeat(30)}end`)))
  })

  it('validates names', () => {
    for (const ok of ['bot', 'zz-test', 'a1', 'a_b-c']) {
      assert.ok(BOT_NAME.test(ok), ok)
    }

    for (const bad of ['', 'Bot', '-bot', '_bot', 'a b', 'a'.repeat(65)]) {
      assert.ok(!BOT_NAME.test(bad), bad)
    }
  })

  it('protects the server’s own profile', () => {
    assert.ok(isProtectedProfile('default'))
    assert.ok(!isProtectedProfile('laptop'))
    assert.ok(!isProtectedProfile('zz-test'))
  })
})

describe('mergeBotMeta', () => {
  it('lays the patch over what is there and keeps the rest', () => {
    assert.deepEqual(mergeBotMeta({ title: 'A', pinned: true, shape: 'circle' }, { shape: 'hexagon', color: 'red' }), { title: 'A', pinned: true, shape: 'hexagon', color: 'red' })
  })

  it('clears a key set to null and ignores undefined', () => {
    assert.deepEqual(mergeBotMeta({ title: 'A', hidden: true }, { hidden: null, title: undefined }), { title: 'A' })
  })

  it('starts from nothing', () => {
    assert.deepEqual(mergeBotMeta(undefined, { pinned: true }), { pinned: true })
  })
})

describe('updateBotMeta', () => {
  it('sends the whole merged object with the revision it read', async () => {
    const { client, calls } = fakeClient({ 'profiles.configure': () => ({ ok: true, applied: { ui_meta: true } }) })
    const stored = await updateBotMeta({ client }, 'bot', { pinned: true }, row({ title: 'Bot', shape: 'circle' }, 4))

    assert.deepEqual(stored, { title: 'Bot', shape: 'circle', pinned: true })
    assert.deepEqual(calls[0]?.params, {
      name: 'bot',
      ui_meta: { 'hermes-bots': { title: 'Bot', shape: 'circle', pinned: true } },
      ui_meta_expected_revisions: { 'hermes-bots': 4 },
    })
  })

  it('counts a bot with no stored settings as revision 0', async () => {
    const { client, calls } = fakeClient({ 'profiles.configure': () => ({ ok: true, applied: { ui_meta: true } }) })
    await updateBotMeta({ client }, 'bot', { hidden: true }, row(undefined))
    assert.deepEqual(calls[0]?.params.ui_meta_expected_revisions, { 'hermes-bots': 0 })
  })

  it('reads the bot first when it was not given one', async () => {
    const { client, calls } = fakeClient({
      'profiles.list': () => ({ profiles: [row({ title: 'Fresh' }, 2)] }),
      'profiles.configure': () => ({ ok: true, applied: { ui_meta: true } }),
    })
    await updateBotMeta({ client }, 'bot', { pinned: true })
    assert.deepEqual(
      calls.map(call => call.method),
      ['profiles.list', 'profiles.configure'],
    )
    assert.deepEqual(calls[1]?.params.ui_meta, { 'hermes-bots': { title: 'Fresh', pinned: true } })
  })

  it('loses a race, reads again and succeeds the second time with the other writer’s changes kept', async () => {
    let attempts = 0
    const { client, calls } = fakeClient({
      'profiles.configure': () => (++attempts === 1 ? { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected: 4, actual: 5 } } } } : { ok: true, applied: { ui_meta: true } }),
    })
    const stored = await updateBotMeta({ client, readRow: async () => row({ title: 'Bot', color: 'blue' }, 5) }, 'bot', { pinned: true }, row({ title: 'Bot' }, 4))

    assert.deepEqual(stored, { title: 'Bot', color: 'blue', pinned: true })
    assert.deepEqual(calls[1]?.params.ui_meta_expected_revisions, { 'hermes-bots': 5 })
  })

  it('gives up after a second conflict', async () => {
    const { client, calls } = fakeClient({ 'profiles.configure': () => ({ ok: false, applied: { ui_meta: false } }) })
    await assert.rejects(updateBotMeta({ client, readRow: async () => row({}, 1) }, 'bot', { pinned: true }, row({}, 0)), MetaConflictError)
    assert.equal(calls.length, 2)
  })
})

describe('changeModel', () => {
  it('writes a model the server does not flag', async () => {
    const { client, calls } = fakeClient({ 'profiles.configure': () => ({ ok: true, applied: { model: true } }) })
    assert.deepEqual(await changeModel(client, 'bot', 'm', 'p'), { kind: 'done' })
    assert.deepEqual(calls[0]?.params, { name: 'bot', model: 'm', provider: 'p' })
  })

  it('asks first for a flagged model, and writes it once confirmed', async () => {
    const { client, calls } = fakeClient({
      'profiles.configure': params => (params.confirm_expensive_model ? { ok: true, applied: { model: true } } : { ok: true, applied: {}, confirm_required: true, confirm_message: 'Costs more' }),
    })
    assert.deepEqual(await changeModel(client, 'bot', 'big', 'p'), { kind: 'confirm', message: 'Costs more' })
    assert.deepEqual(await changeModel(client, 'bot', 'big', 'p', true), { kind: 'done' })
    assert.equal(calls[1]?.params.confirm_expensive_model, true)
  })

  it('reports a write that did not take', async () => {
    const { client } = fakeClient({ 'profiles.configure': () => ({ ok: false, applied: { model: false } }) })
    assert.deepEqual(await changeModel(client, 'bot', 'm', 'p'), { kind: 'failed' })
  })
})

describe('createBot', () => {
  const created = { ok: true, name: 'zz-new', path: '/x', soul_written: false, model_set: false }

  it('copies the default bot with its sign-ins, then sets the look', async () => {
    const { client, calls } = fakeClient({ 'profiles.create': () => created, 'profiles.configure': () => ({ ok: true, applied: { ui_meta: true } }) })
    const result = await createBot(client, { title: 'Zz New', name: 'zz-new', description: ' A helper ', soul: '' }, () => 1234)

    assert.equal(result.name, 'zz-new')
    assert.deepEqual(calls[0], { method: 'profiles.create', params: { name: 'zz-new', description: 'A helper', clone_from: 'default', share_auth: true } })
    assert.deepEqual(calls[1], { method: 'profiles.configure', params: { name: 'zz-new', ui_meta: { 'hermes-bots': { shape: 'blobatar', title: 'Zz New', created: 1234 } } } })
  })

  it('sends the instructions only when there are some', async () => {
    const { client, calls } = fakeClient({ 'profiles.create': () => created, 'profiles.configure': () => ({ ok: true, applied: {} }) })
    await createBot(client, { title: 'X', name: 'zz-new', description: '', soul: 'Be brief.' })
    assert.equal(calls[0]?.params.soul, 'Be brief.')
  })

  it('refuses a name the server would refuse, without calling it', async () => {
    const { client, calls } = fakeClient({})
    await assert.rejects(createBot(client, { title: 'X', name: 'Bad Name', description: '', soul: '' }), /lowercase letters/)
    assert.equal(calls.length, 0)
  })

  it('does not set a look when the profile could not be made', async () => {
    const { client, calls } = fakeClient({
      'profiles.create': () => {
        throw new Error('already exists')
      },
    })
    await assert.rejects(createBot(client, { title: 'X', name: 'zz-new', description: '', soul: '' }), /already exists/)
    assert.equal(calls.length, 1)
  })
})

describe('modelSections', () => {
  const many = Array.from({ length: 30 }, (_, index) => `model-${index}`)
  const options: ModelOptions = {
    model: 'zeta',
    provider: 'beta',
    providers: [
      { slug: 'alpha', name: 'Alpha', models: many, featured_models: ['model-3', 'model-1'] },
      { slug: 'beta', name: 'Beta AI', models: ['zeta', 'eta', 'theta'] },
      { slug: 'empty', name: 'Empty', models: [] },
    ],
  }

  it('puts the bot’s own provider first, and its own model first within it', () => {
    const sections = modelSections(options, '')
    assert.deepEqual(
      sections.map(section => section.slug),
      ['beta', 'alpha'],
    )
    assert.deepEqual(sections[0]?.models, ['zeta', 'eta', 'theta'])
  })

  it('shows the featured models of a big catalog, and says how many more there are', () => {
    const alpha = modelSections(options, '').find(section => section.slug === 'alpha')
    assert.deepEqual(alpha?.models, ['model-3', 'model-1'])
    assert.equal(alpha?.hidden, 28)
  })

  it('shows a short default list when there are no featured models', () => {
    const plain: ModelOptions = { model: 'x', provider: 'p', providers: [{ slug: 'p', name: 'P', models: many }] }
    const shown = modelSections(plain, '')[0]
    assert.equal(shown?.models.length, 9, 'eight, plus the bot’s own model')
    assert.equal(shown?.hidden, 21)
  })

  it('shows everything for a provider the person expanded', () => {
    const alpha = modelSections(options, '', new Set(['alpha'])).find(section => section.slug === 'alpha')
    assert.equal(alpha?.models.length, 30)
    assert.equal(alpha?.hidden, 0)
  })

  it('searches every provider, by model or by provider name', () => {
    assert.deepEqual(
      modelSections(options, 'MODEL-2').map(section => [section.slug, section.models]),
      [['alpha', ['model-2', 'model-20', 'model-21', 'model-22', 'model-23', 'model-24', 'model-25', 'model-26', 'model-27', 'model-28', 'model-29']]],
    )
    assert.deepEqual(modelSections(options, 'beta ai')[0]?.models, ['zeta', 'eta', 'theta'])
    assert.deepEqual(modelSections(options, 'nothing like this'), [])
  })

  it('leaves out a provider with nothing to pick', () => {
    assert.ok(!modelSections(options, '').some(section => section.slug === 'empty'))
  })

  it('still lists the bot’s model when its provider reports none', () => {
    const odd: ModelOptions = { model: 'custom-1', provider: 'mine', providers: [{ slug: 'mine', name: 'Mine', models: [] }] }
    assert.deepEqual(modelSections(odd, '')[0]?.models, ['custom-1'])
  })
})

describe('skills', () => {
  const skills = [
    { name: 'web', enabled: true },
    { name: 'git', enabled: false },
    { name: 'audio', enabled: false },
  ]

  it('sends the whole list of disabled ones, sorted', () => {
    assert.deepEqual(disabledSkills(skills), ['audio', 'git'])
  })

  it('switches one and keeps the order', () => {
    const next = withSkill(skills, 'git', true)
    assert.deepEqual(next.map(skill => skill.name), ['web', 'git', 'audio'])
    assert.deepEqual(disabledSkills(next), ['audio'])
    assert.deepEqual(disabledSkills(withSkill(skills, 'web', false)), ['audio', 'git', 'web'])
  })

  it('lists a skill once even when the server finds it in two folders, and switches both', () => {
    const doubled = [
      { name: 'computer-use', enabled: true },
      { name: 'Audio', enabled: true },
      { name: 'computer-use', enabled: true },
    ]
    assert.deepEqual(uniqueSkills(doubled).map(skill => skill.name), ['Audio', 'computer-use'])
    assert.deepEqual(disabledSkills(withSkill(doubled, 'computer-use', false)), ['computer-use'])
    assert.deepEqual(disabledSkills(withSkill(doubled, 'AUDIO', false)), ['Audio'])
  })
})

describe('approvals', () => {
  it('reads the mode, with anything missing or unknown meaning "ask me"', () => {
    assert.equal(approvalModeOf({ approvals: { mode: 'smart' } }), 'smart')
    assert.equal(approvalModeOf({ approvals: { mode: 'off' } }), 'off')
    assert.equal(approvalModeOf({ approvals: { mode: 'manual' } }), 'manual')
    assert.equal(approvalModeOf({ approvals: { mode: 'yolo' } }), 'manual')
    assert.equal(approvalModeOf({ approvals: false }), 'manual')
    assert.equal(approvalModeOf({}), 'manual')
    assert.equal(approvalModeOf(null), 'manual')
  })

  it('reads whether the browser runs in a visible window, headless when unset', () => {
    assert.equal(browserHeadedOf({ browser: { headed: true } }), true)
    assert.equal(browserHeadedOf({ browser: { headed: 'true' } }), true)
    assert.equal(browserHeadedOf({ browser: { headed: false } }), false)
    assert.equal(browserHeadedOf({ browser: {} }), false)
    assert.equal(browserHeadedOf({}), false)
    assert.equal(browserHeadedOf(null), false)
  })

  it('offers the three modes the server knows', () => {
    assert.deepEqual(APPROVAL_MODES.map(mode => mode.value), ['manual', 'smart', 'off'])
  })
})

describe('a chat on another model than the bot', () => {
  it('names the chat’s model when it is not the default, with or without provider prefixes', () => {
    assert.equal(chatModelDiffers('z-ai/glm-5.3-flash', 'x-ai/grok-4.6'), 'grok-4.6')
    assert.equal(chatModelDiffers('z-ai/glm-5.3-flash', 'glm-5.3-flash'), null)
    assert.equal(chatModelDiffers('z-ai/glm-5.3-flash', undefined), null)
    assert.equal(chatModelDiffers('', 'grok-4.6'), null)
  })
})
