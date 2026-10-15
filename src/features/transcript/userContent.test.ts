import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { skillInvocation, splitUserContent } from './userContent.ts'

// A message as Hermes 0.21.6 stores it for a photo and a text file sent from the app.
const STORED = [
  '@file:attachments/hb-notes.txt',
  'What is the secret codeword in the text file, and what color is the picture? Short answer.',
  '',
  '--- Attached Context ---',
  '',
  '📄 @file:attachments/hb-notes.txt (10 tokens)',
  '```',
  'The secret codeword is PINEAPPLE-4821.',
  '',
  '```',
  '@image:/home/orion/.hermes/profiles/zz-attach/images/upload_20261009_201143_1.png',
  '[screenshot]',
].join('\n')

describe('what a stored message says', () => {
  it('shows your words and one chip per attachment, without the file’s contents', () => {
    const { text, chips } = splitUserContent(STORED)
    assert.equal(text, 'What is the secret codeword in the text file, and what color is the picture? Short answer.')
    assert.deepEqual(chips, [
      { kind: 'file', name: 'hb-notes.txt', path: 'attachments/hb-notes.txt' },
      { kind: 'image', name: 'upload_20261009_201143_1.png', path: '/home/orion/.hermes/profiles/zz-attach/images/upload_20261009_201143_1.png' },
    ])
  })

  it('lists a file once even though it is both at the top of the message and in the attached context', () => {
    assert.equal(splitUserContent(STORED).chips.filter(chip => chip.name === 'hb-notes.txt').length, 1)
  })

  it('leaves a plain message exactly as it was', () => {
    assert.deepEqual(splitUserContent('hello there\n\nsecond paragraph'), { text: 'hello there\n\nsecond paragraph', chips: [] })
  })

  it('leaves a reference you wrote in the middle of a sentence where you put it', () => {
    assert.deepEqual(splitUserContent('please open @file:src/app.ts and fix it'), { text: 'please open @file:src/app.ts and fix it', chips: [] })
  })

  it('shows a picture sent with no words as just the picture', () => {
    const stored = '[User attached image: upload_1.png]\n\n--- Attached Context ---\n\n@image:/h/images/upload_1.png\n[screenshot]'
    assert.deepEqual(splitUserContent(stored), { text: '', chips: [{ kind: 'image', name: 'upload_1.png', path: '/h/images/upload_1.png' }] })
  })

  it('shows a PDF once, by name, not as its rendered pages', () => {
    const stored = [
      '[User attached PDF: report.pdf (2 page(s))]',
      'Summarise it',
      '',
      '--- Attached Context ---',
      '',
      '@image:/h/images/pdf_p1-1_20261009.png',
      '@image:/h/images/pdf_p1-2_20261009.png',
    ].join('\n')
    assert.deepEqual(splitUserContent(stored), { text: 'Summarise it', chips: [{ kind: 'pdf', name: 'report.pdf' }] })
  })

  it('drops the warnings Hermes appends', () => {
    assert.equal(splitUserContent('hi\n\n--- Context Warnings ---\nfile too large').text, 'hi')
  })

  it('reads quoted paths with spaces', () => {
    const stored = '@file:"my notes/to do.txt"\nread this\n\n--- Attached Context ---\n\n@file:"my notes/to do.txt" (4 tokens)'
    assert.deepEqual(splitUserContent(stored), { text: 'read this', chips: [{ kind: 'file', name: 'to do.txt', path: 'my notes/to do.txt' }] })
  })

  it('ignores context that is not a file or a picture', () => {
    const stored = 'look\n\n--- Attached Context ---\n\n@url:https://example.com (200 tokens)\n@folder:src'
    assert.deepEqual(splitUserContent(stored), { text: 'look', chips: [] })
  })
})

// What Hermes writes for `/work fix the leak` (agent/skill_commands.py): the announcement, the skill, then the words.
const SKILL_HEAD = ['[IMPORTANT: The user has invoked the "work" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]', '', '# Work', 'Pick the next task.', '', '[Skill directory: /home/orion/.hermes/skills/work]', 'Resolve any relative paths in this skill against that directory.']

describe('a picture sent with words', () => {
  it('shows the words and a chip when the stored message ends in an @image line and a [screenshot] marker', () => {
    const stored = 'What color is this? Then make me a picture.\n@image:/home/orion/.hermes/profiles/zz-pics/images/upload_20261009_221316_1.png\n[screenshot]'

    assert.deepEqual(splitUserContent(stored), {
      text: 'What color is this? Then make me a picture.',
      chips: [{ kind: 'image', name: 'upload_20261009_221316_1.png', path: '/home/orion/.hermes/profiles/zz-pics/images/upload_20261009_221316_1.png' }],
    })
  })

  it('takes several pictures, and trailing blank lines', () => {
    const { text, chips } = splitUserContent('Which is bigger?\n@image:/h/a.png\n[screenshot]\n@image:/h/b.png\n[screenshot]\n\n')

    assert.equal(text, 'Which is bigger?')
    assert.deepEqual(chips.map(chip => chip.name), ['a.png', 'b.png'])
  })

  it('leaves an @image reference in the middle of the words alone', () => {
    const stored = 'Compare @image:/h/a.png with the other one please'

    assert.deepEqual(splitUserContent(stored), { text: stored, chips: [] })
  })
})

describe('a skill turn', () => {
  it('shows what you typed, not the skill', () => {
    const stored = [...SKILL_HEAD, '', 'The user has provided the following instruction alongside the skill invocation: fix the leak'].join('\n')

    assert.equal(skillInvocation(stored), '/work fix the leak')
    assert.deepEqual(splitUserContent(stored), { text: '/work fix the leak', chips: [] })
  })

  it('shows just the command when it was run without words', () => {
    assert.equal(skillInvocation(SKILL_HEAD.join('\n')), '/work')
  })

  it('stops at the runtime note the server may add after your words', () => {
    const stored = [...SKILL_HEAD, '', 'The user has provided the following instruction alongside the skill invocation: fix the leak', '', '[Runtime note: running from the phone]'].join('\n')

    assert.equal(skillInvocation(stored), '/work fix the leak')
  })

  it('takes the last marker when the skill itself quotes the instruction line', () => {
    const quoting = [...SKILL_HEAD, 'It says: The user has provided the following instruction alongside the skill invocation: not this', '', 'The user has provided the following instruction alongside the skill invocation: really this'].join('\n')

    assert.equal(skillInvocation(quoting), '/work really this')
  })

  it('shows a stacked or bundled invocation as it was typed', () => {
    const stored = ['[IMPORTANT: The user has invoked the "/clean /work" stacked skill bundle, loading 2 skills together. Treat every skill below as active guidance for this turn.]', '', 'Skills loaded: clean, work', '', 'User instruction: tidy up', '', '[Loaded as part of the stacked skill invocation "clean".]', 'body'].join('\n')

    assert.equal(skillInvocation(stored), '/clean /work tidy up')
  })

  it('collapses a multi-line instruction to one line and drops the cut-off tail of a preview', () => {
    const stored = [...SKILL_HEAD, '', 'The user has provided the following instruction alongside the skill invocation: fix\n  the leak\x1etail of a long message'].join('\n')

    assert.equal(skillInvocation(stored), '/work fix the leak')
  })

  it('is not fooled by an ordinary message that mentions skills', () => {
    assert.equal(skillInvocation('I invoked the "work" skill yesterday'), null)
    assert.deepEqual(splitUserContent('[IMPORTANT: something else]'), { text: '[IMPORTANT: something else]', chips: [] })
  })
})
