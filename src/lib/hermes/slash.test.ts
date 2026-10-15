import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CommandsCatalog } from './protocol.ts'
import { classify, dispatchOf, helpGroups, helpText, parseSlash, pickerQuery, rankOptions, REWRITES_CHAT, slashOptions, splitUsage, stripAnsi } from './slash.ts'

// The server leaves out the messaging-gateway commands (/restart, /pause, /approve…) but still knows them in `commands`, and marks
// the ones Desktop does not list (`desktop`: "terminal", "messaging"…).
const catalog: CommandsCatalog = {
  pairs: [
    ['/new', 'Start a new session'],
    ['/status', 'Show session, model, token, and context info'],
    ['/usage', 'Show token usage and rate limits; `reset` redeems a banked Codex limit reset (usage: /usage [reset [--force]])'],
    ['/update', 'Update Hermes Agent to the latest version'],
    ['/undo', 'Back up N user turns and re-prompt (usage: /undo [N])'],
    ['/queue', 'Queue a prompt for the next turn (usage: /queue <prompt>)'],
    ['/redraw', 'Force a full UI repaint (recovers from terminal drift)'],
    ['/config', 'Show current configuration'],
    ['/history', 'Show conversation history'],
    ['/density', 'Toggle compact display mode'],
    ['/resume', 'Resume a previously-named session'],
    ['/quit', 'Exit the CLI'],
    ['/deploy', 'Deploy the site (quick command)'],
    ['/github-pr-workflow', 'Open and review pull requests'],
    ['/work', 'Work through a task list'],
    ['/plan-trip', 'Plan a trip'],
  ],
  canon: { '/new': '/new', '/reset': '/new', '/clear': '/new', '/status': '/status', '/usage': '/usage', '/update': '/update', '/undo': '/undo', '/queue': '/queue', '/q': '/queue', '/redraw': '/redraw', '/resume': '/resume', '/quit': '/quit', '/exit': '/quit', '/deploy': '/deploy' },
  commands: { '/approve': { desktop: 'messaging' }, '/restart': { desktop: 'terminal' }, '/status': {}, '/update': { desktop: 'terminal' }, '/redraw': { desktop: 'terminal' }, '/config': { desktop: 'terminal' }, '/quit': { desktop: 'terminal' }, '/undo': {} },
  categories: [
    { name: 'Session', pairs: [['/new', 'Start a new session'], ['/undo', 'Back up N user turns and re-prompt (usage: /undo [N])']] },
    { name: 'User commands', pairs: [['/deploy', 'Deploy the site (quick command)']] },
    { name: 'TUI', pairs: [['/density', 'Toggle compact display mode']] },
  ],
  skills: { '/github-pr-workflow': { usage: 3, origin: 'hub' }, '/work': { usage: 40, origin: 'local' }, '/plan-trip': { usage: 0, origin: 'local' } },
}

const options = slashOptions(catalog)
const names = (list: { name: string }[]) => list.map(option => option.name)

describe('parseSlash', () => {
  it('splits the command from its words', () => {
    assert.deepEqual(parseSlash('/Work fix the leak'), { name: 'work', arg: 'fix the leak' })
    assert.deepEqual(parseSlash('  /status  '), { name: 'status', arg: '' })
    assert.deepEqual(parseSlash('/goal ship it\nby friday'), { name: 'goal', arg: 'ship it\nby friday' })
  })

  it('does not take a path or a sentence for a command', () => {
    assert.equal(parseSlash('/home/orion/notes.md'), null)
    assert.equal(parseSlash('hello /work'), null)
    assert.equal(parseSlash('/'), null)
    assert.equal(parseSlash('//'), null)
  })
})

describe('slashOptions', () => {
  it('lists the commands the server does that are of use from a phone, then the skills', () => {
    assert.deepEqual(names(options), ['/new', '/status', '/usage', '/update', '/undo', '/queue', '/config', '/resume', '/deploy', '/github-pr-workflow', '/work', '/plan-trip'])
  })

  it('leaves out the commands for the terminal and the machine it runs on, and the TUI category, but still runs them when typed', () => {
    for (const hidden of ['/redraw', '/history', '/density', '/quit']) {
      assert.ok(!names(options).includes(hidden), hidden)
    }

    assert.deepEqual(classify('/redraw', options, catalog), { kind: 'run', name: 'redraw', arg: '', run: 'exec', known: true })
    assert.deepEqual(classify('/quit', options, catalog), { kind: 'local', name: 'quit', arg: '', local: 'leave' })
  })

  it('keeps the bot’s own command that shares a name with a hidden one', () => {
    const own: CommandsCatalog = { ...catalog, pairs: [...catalog.pairs, ['/export', 'My own export']], categories: [...(catalog.categories ?? []), { name: 'User commands', pairs: [['/export', 'My own export']] }] }

    assert.ok(names(slashOptions(own)).includes('/export'))
  })

  it('does not offer a hidden command in /help either', () => {
    assert.ok(!helpText(catalog).includes('/redraw') && !helpText(catalog).includes('/density'))
  })

  it('does not list the messaging-gateway commands the server leaves out, but still runs them when typed', () => {
    assert.ok(!names(options).includes('/restart'))
    assert.deepEqual(classify('/restart', options, catalog), { kind: 'run', name: 'restart', arg: '', run: 'exec', known: true })
  })

  it('splits the "(usage: …)" tail off the description into a hint', () => {
    const by = Object.fromEntries(options.map(option => [option.name, option]))

    assert.deepEqual([by['/usage']!.description, by['/usage']!.hint], ['Show token usage and rate limits; `reset` redeems a banked Codex limit reset', '[reset [--force]]'])
    assert.deepEqual([by['/queue']!.description, by['/queue']!.hint], ['Queue a prompt for the next turn', '<prompt>'])
    assert.deepEqual([by['/status']!.description, by['/status']!.hint], ['Show session, model, token, and context info', ''])
  })

  it('marks the commands Hermes Desktop keeps out of its own list', () => {
    const secondary = options.filter(option => option.secondary).map(option => option.name)

    assert.deepEqual(secondary, ['/update', '/config'])
  })

  it('knows which the server’s own runner takes and which only command.dispatch knows, and which are skills', () => {
    const by = Object.fromEntries(options.map(option => [option.name, option]))

    assert.equal(by['/update']!.run, 'exec')
    assert.equal(by['/update']!.kind, 'command')
    assert.equal(by['/deploy']!.run, 'dispatch')
    assert.equal(by['/deploy']!.kind, 'command')
    assert.equal(by['/work']!.run, 'dispatch')
    assert.equal(by['/work']!.kind, 'skill')
    assert.equal(by['/work']!.usage, 40)
    assert.equal(by['/work']!.description, 'Work through a task list')
  })

  it('keeps a built-in when a skill has its name', () => {
    const clash: CommandsCatalog = { ...catalog, skills: { ...catalog.skills, '/status': { usage: 9 } } }

    assert.equal(slashOptions(clash).find(option => option.name === '/status')?.kind, 'command')
  })

  it('still lists a skill that an older server left out of the pairs', () => {
    const older: CommandsCatalog = { ...catalog, pairs: catalog.pairs.filter(([name]) => name !== '/work') }

    assert.equal(slashOptions(older).find(option => option.name === '/work')?.kind, 'skill')
  })

  it('survives a catalog with parts missing', () => {
    assert.deepEqual(slashOptions({ pairs: [], canon: {}, skills: {} }), [])
    assert.deepEqual(names(slashOptions({ pairs: [['/work', 'x']], canon: {}, skills: undefined as never })), ['/work'])
  })
})

describe('splitUsage', () => {
  it('takes the last "(usage: …)" and leaves other brackets in the sentence alone', () => {
    assert.deepEqual(splitUsage("Compress context (add 'here [N]' to keep recent) (usage: /compress [focus])"), { description: "Compress context (add 'here [N]' to keep recent)", hint: '[focus]' })
    assert.deepEqual(splitUsage('No tail here'), { description: 'No tail here', hint: '' })
    assert.deepEqual(splitUsage('Bare (usage: /thing)'), { description: 'Bare', hint: '' })
  })
})

describe('stripAnsi', () => {
  it('removes the colour and cursor codes a terminal program prints', () => {
    assert.equal(stripAnsi('\u001b[1;31mUnknown command: /x\u001b[0m\nDid you mean \u001b[2m/y\u001b[0m?'), 'Unknown command: /x\nDid you mean /y?')
    assert.equal(stripAnsi('\u001b]0;title\u0007plain\u001b[2K'), 'plain')
    assert.equal(stripAnsi('already plain'), 'already plain')
  })
})

describe('rankOptions', () => {
  it('lists the commands first, then skills by use, then the commands that are for a terminal, when nothing is typed', () => {
    assert.deepEqual(names(rankOptions(options, '')), ['/new', '/status', '/usage', '/undo', '/queue', '/resume', '/deploy', '/work', '/github-pr-workflow', '/plan-trip', '/update', '/config'])
  })

  it('puts names that start with the text before names that contain it', () => {
    // `/new` has a w in it, and `/work` starts with one: starting beats containing.
    assert.deepEqual(names(rankOptions(options, 'w')).slice(0, 3), ['/work', '/github-pr-workflow', '/new'])
  })

  it('puts a terminal command after an equal match, never before it', () => {
    // Both start with "c"; /config is for a terminal, so it comes after.
    const found = names(rankOptions(options, 'c'))

    assert.ok(found.indexOf('/config') > found.indexOf('/queue') || !found.includes('/queue'))
    assert.deepEqual(names(rankOptions(options, 'conf')), ['/config'])
  })

  it('does not find a hidden command, even by name', () => {
    assert.deepEqual(names(rankOptions(options, 'redr')), [])
  })

  it('matches a word of the description when no name matches', () => {
    assert.deepEqual(names(rankOptions(options, 'pull')), ['/github-pr-workflow'])
    assert.deepEqual(names(rankOptions(options, 'xyz')), [])
  })

  it('treats an underscore like a hyphen and ignores a leading slash', () => {
    assert.deepEqual(names(rankOptions(options, '/plan_t')), ['/plan-trip'])
  })

  it('caps the list', () => {
    assert.equal(rankOptions(options, '', 3).length, 3)
  })
})

describe('pickerQuery', () => {
  it('is open only while the command word is being typed', () => {
    assert.equal(pickerQuery('/'), '')
    assert.equal(pickerQuery('/wo'), 'wo')
    assert.equal(pickerQuery('/work '), null)
    assert.equal(pickerQuery('/work fix'), null)
    assert.equal(pickerQuery('hello'), null)
    assert.equal(pickerQuery('/home/orion'), null)
  })
})

describe('classify', () => {
  it('runs a skill and the bot’s own command through dispatch, and a built-in through the server’s runner', () => {
    assert.deepEqual(classify('/work fix the leak', options, catalog), { kind: 'run', name: 'work', arg: 'fix the leak', run: 'dispatch', known: true })
    assert.deepEqual(classify('/deploy', options, catalog), { kind: 'run', name: 'deploy', arg: '', run: 'dispatch', known: true })
    assert.deepEqual(classify('/status', options, catalog), { kind: 'run', name: 'status', arg: '', run: 'exec', known: true })
  })

  it('runs /update and the commands with words that change things as typed', () => {
    assert.deepEqual(classify('/update', options, catalog), { kind: 'run', name: 'update', arg: '', run: 'exec', known: true })
    assert.deepEqual(classify('/usage reset', options, catalog), { kind: 'run', name: 'usage', arg: 'reset', run: 'exec', known: true })
  })

  it('resolves an alias to its command', () => {
    assert.deepEqual(classify('/q hello', options, catalog), { kind: 'run', name: 'queue', arg: 'hello', run: 'exec', known: true })
  })

  it('runs a built-in the picker does not list but the server knows', () => {
    assert.deepEqual(classify('/approve once', options, catalog), { kind: 'run', name: 'approve', arg: 'once', run: 'exec', known: true })
  })

  it('answers a new chat, the chats list and leaving with the app’s own screens', () => {
    assert.deepEqual(classify('/new', options, catalog), { kind: 'local', name: 'new', arg: '', local: 'new' })
    assert.deepEqual(classify('/reset', options, catalog), { kind: 'local', name: 'new', arg: '', local: 'new' })
    assert.deepEqual(classify('/clear', options, catalog), { kind: 'local', name: 'new', arg: '', local: 'new' })
    assert.deepEqual(classify('/resume work', options, catalog), { kind: 'local', name: 'resume', arg: 'work', local: 'chats' })
    assert.deepEqual(classify('/exit', options, catalog), { kind: 'local', name: 'quit', arg: '', local: 'leave' })
    assert.deepEqual(classify('/help skills', options, catalog), { kind: 'local', name: 'help', arg: 'skills', local: 'help' })
  })

  it('does not take a skill or the bot’s own command for the app’s, even if it shares a name', () => {
    const clash: CommandsCatalog = { ...catalog, pairs: [...catalog.pairs, ['/sessions', 'My own command']], categories: [...(catalog.categories ?? []), { name: 'Plugin commands', pairs: [['/sessions', 'My own command']] }] }

    assert.deepEqual(classify('/sessions now', slashOptions(clash), clash), { kind: 'run', name: 'sessions', arg: 'now', run: 'dispatch', known: true })
  })

  it('tries a command it has never heard of (it may be a bundle) rather than guessing', () => {
    assert.deepEqual(classify('/morning-pack now', options, catalog), { kind: 'run', name: 'morning-pack', arg: 'now', run: 'dispatch', known: false })
  })

  it('sends plain text, paths and anything before the catalog has loaded as a message', () => {
    assert.deepEqual(classify('hello', options, catalog), { kind: 'text' })
    assert.deepEqual(classify('/home/orion/x', options, catalog), { kind: 'text' })
    assert.deepEqual(classify('/work now', [], undefined), { kind: 'text' })
  })
})

describe('helpText', () => {
  it('lists the command names by category as a short list, and says where to find the rest', () => {
    assert.equal(helpText(catalog), ['Session:', '/new  /undo', '', 'User commands:', '/deploy', '', 'Type / and part of a name to see what each does. /help <word> searches, and /help skills lists the 3 skills.'].join('\n'))
  })

  it('gives the same list as groups of whole names for a wrapping layout', () => {
    assert.deepEqual(helpGroups(catalog), {
      groups: [
        { title: 'Session', names: ['/new', '/undo'] },
        { title: 'User commands', names: ['/deploy'] },
      ],
      footer: 'Type / and part of a name to see what each does. /help <word> searches, and /help skills lists the 3 skills.',
    })
  })

  it('lists the skills for "skills"', () => {
    assert.equal(helpText(catalog, 'skills'), ['Skills (3):', '/github-pr-workflow  Open and review pull requests', '/plan-trip  Plan a trip', '/work  Work through a task list'].join('\n'))
  })

  it('gives each match with its arguments and what it does for a word', () => {
    assert.equal(helpText(catalog, 'queue'), '/queue <prompt>\n    Queue a prompt for the next turn')
    assert.match(helpText(catalog, '/DEPLOY'), /^\/deploy\n {4}Deploy the site/)
    assert.equal(helpText(catalog, 'zzzz'), 'Nothing mentions “zzzz”.')
  })

  it('copes with a catalog that has nothing in it', () => {
    assert.equal(helpText({ pairs: [], canon: {}, skills: {} }), 'Type / and part of a name to see what each does. /help <word> searches, and /help skills lists the 0 skills.')
    assert.equal(helpText({ pairs: [], canon: {}, skills: {} }, 'skills'), 'No skills.')
  })
})

describe('REWRITES_CHAT', () => {
  it('names the commands that change what the server keeps of a chat', () => {
    assert.ok(REWRITES_CHAT.has('undo') && REWRITES_CHAT.has('retry') && REWRITES_CHAT.has('compress'))
    assert.ok(!REWRITES_CHAT.has('status'))
  })
})

describe('dispatchOf', () => {
  it('reads each kind of answer', () => {
    assert.deepEqual(dispatchOf({ type: 'exec', output: 'ok' }), { type: 'exec', output: 'ok' })
    assert.deepEqual(dispatchOf({ type: 'plugin' }), { type: 'plugin', output: '' })
    assert.deepEqual(dispatchOf({ type: 'alias', target: 'status' }), { type: 'alias', target: 'status' })
    assert.deepEqual(dispatchOf({ type: 'skill', message: 'BODY', display: '/work x', name: 'work' }), { type: 'skill', message: 'BODY', display: '/work x', name: 'work' })
    assert.deepEqual(dispatchOf({ type: 'send', message: 'go', notice: ' ⊙ Goal set ' }), { type: 'send', message: 'go', notice: '⊙ Goal set' })
    assert.deepEqual(dispatchOf({ type: 'prefill', message: 'earlier words' }), { type: 'prefill', message: 'earlier words' })
  })

  it('refuses what it does not understand', () => {
    assert.equal(dispatchOf(null), null)
    assert.equal(dispatchOf({ output: 'plain slash.exec output' }), null)
    assert.equal(dispatchOf({ type: 'alias' }), null)
    assert.equal(dispatchOf({ type: 'send' }), null)
    assert.equal(dispatchOf({ type: 'surprise', message: 'x' }), null)
  })
})
