import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { GatewayEvent } from '../../lib/hermes/gateway-client.ts'
import { asHermesEvent, type HermesEvent, type ToolResult } from '../../lib/hermes/protocol.ts'
import { appendError, appendNote, appendOutput, appendUser, finishOutput, startOutput, answerPrompt, exitSetter, expirePrompt, failUser, initialTranscript, isRealFailure, pendingPrompts, quietStatus, readResult, reduceEvent } from './reduce.ts'
import type { Item, TranscriptState } from './types.ts'

const dir = new URL('../../../docs/protocol-captures/', import.meta.url)
const NOW = 1_000_000

/** Replays one captured turn through the reducer, with a fixed clock. */
function replay(name: string, start: TranscriptState = initialTranscript()): TranscriptState {
  return readFileSync(new URL(`${name}.jsonl`, dir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { kind: string; event?: GatewayEvent })
    .flatMap(line => (line.kind === 'event' && line.event ? (asHermesEvent(line.event) ?? []) : []))
    .reduce((state, event) => reduceEvent(state, event, NOW), start)
}

function ev<T extends HermesEvent['type']>(type: T, payload: Extract<HermesEvent, { type: T }>['payload']): HermesEvent {
  return { type, payload, session_id: 's' } as HermesEvent
}

const kinds = (state: TranscriptState) => state.items.map(item => item.kind)

describe('replaying captured turns', () => {
  it('basic: one finished assistant bubble', () => {
    const state = replay('basic')
    assert.deepEqual(kinds(state), ['assistant'])
    const bubble = state.items[0] as Extract<Item, { kind: 'assistant' }>
    assert.equal(bubble.text, 'Hi from the fake model, happy to help.')
    assert.equal(bubble.streaming, false)
    assert.equal(state.running, false)
    assert.equal(state.phase, 'idle')
    assert.equal(state.lastTurn, 'complete')
    // The server first titles the chat from the prompt, then re-titles it from the reply.
    assert.equal(typeof state.title, 'string')
    assert.ok(state.title?.length)
    assert.equal(state.usage?.total, 30)
  })

  it('approval: text, then one folded activity step, the approval, and the reply', () => {
    const state = replay('approval')
    assert.deepEqual(kinds(state), ['assistant', 'activity', 'approval', 'assistant'])

    const [first, activity, approval, last] = state.items as [Item, Item, Item, Item]
    assert.equal((first as { text: string }).text, 'Running that now.')
    assert.equal((first as { streaming: boolean }).streaming, false)

    assert.equal(activity.kind === 'activity' && activity.steps.length, 1)
    const step = activity.kind === 'activity' ? activity.steps[0] : undefined
    assert.equal(step?.name, 'terminal')
    assert.equal(step?.state, 'blocked')
    assert.match(step?.context ?? '', /^rm -r \/tmp\/hermesbot-smoke-/)
    assert.equal(step?.resultLine, 'Denied')

    // The user denied it, so the tool completed as blocked; the card records the answer.
    assert.equal(approval.kind === 'approval' && approval.state, 'answered')
    assert.equal(approval.kind === 'approval' && approval.choice, 'deny')
    assert.deepEqual(approval.kind === 'approval' && approval.choices, ['once', 'session', 'always', 'deny'])

    // The reply opened with blank lines; the bubble does not.
    assert.equal(last.kind === 'assistant' && last.text.startsWith('Done.'), true)
    assert.equal(state.running, false)
    assert.deepEqual(pendingPrompts(state), [])
  })

  it('interrupt: keeps the partial reply and marks it interrupted', () => {
    const state = replay('interrupt')
    const bubble = state.items.at(-1)
    assert.equal(bubble?.kind, 'assistant')
    assert.equal(bubble?.kind === 'assistant' && bubble.status, 'interrupted')
    assert.equal(bubble?.kind === 'assistant' && bubble.streaming, false)
    assert.equal(state.lastTurn, 'interrupted')
    assert.equal(state.running, false)
  })

  it('clarify: a question item that is no longer pending when the turn ends', () => {
    const state = replay('clarify')
    const question = state.items.find(item => item.kind === 'question')
    assert.ok(question && question.kind === 'question')
    assert.equal(question.questions[0]?.choices?.[1], 'Option B')
    assert.notEqual(question.state, 'pending')
    assert.deepEqual(pendingPrompts(state), [])
  })

  it('failure: a single error item, no assistant bubble for the error text', () => {
    const state = replay('failure')
    assert.deepEqual(kinds(state), ['error'])
    assert.match((state.items[0] as { message: string }).message, /HTTP 500/)
    assert.equal(state.lastTurn, 'error')
    assert.equal(state.running, false)
  })

  it('replaying the same turn twice on a fresh state is deterministic', () => {
    assert.deepEqual(replay('approval'), replay('approval'))
  })

  it('does not mutate the previous state', () => {
    const before = initialTranscript()
    const frozen = JSON.stringify(before)
    reduceEvent(before, ev('message.delta', { text: 'hi' }))
    assert.equal(JSON.stringify(before), frozen)
  })
})

describe('streaming text', () => {
  it('appends deltas to one bubble and trims leading blank lines', () => {
    let state = reduceEvent(initialTranscript(), ev('message.start', {}))
    state = reduceEvent(state, ev('message.delta', { text: '\n\n' }))
    assert.equal(state.items.length, 0, 'a whitespace-only delta opens no bubble')
    state = reduceEvent(state, ev('message.delta', { text: '\nHello ' }))
    state = reduceEvent(state, ev('message.delta', { text: 'there' }))
    assert.deepEqual(state.items.map(item => (item.kind === 'assistant' ? item.text : null)), ['Hello there'])
    assert.equal(state.phase, 'writing')
  })

  it('message.complete text is authoritative for the last bubble', () => {
    let state = reduceEvent(initialTranscript(), ev('message.delta', { text: 'Hel' }))
    state = reduceEvent(state, ev('message.complete', { text: 'Hello.', status: 'complete' }))
    assert.equal((state.items[0] as { text: string }).text, 'Hello.')
  })

  it('a reply that never streamed still appears', () => {
    const state = reduceEvent(initialTranscript(), ev('message.complete', { text: 'Only in complete', status: 'complete' }))
    assert.deepEqual(kinds(state), ['assistant'])
  })

  it('interim text is skipped when already streamed, and added when not', () => {
    let state = reduceEvent(initialTranscript(), ev('message.delta', { text: 'Running' }))
    state = reduceEvent(state, ev('message.interim', { text: 'Running', already_streamed: true }))
    assert.equal(state.items.length, 1)
    state = reduceEvent(state, ev('message.interim', { text: 'Side note', already_streamed: false }))
    assert.equal(state.items.length, 2)
    assert.equal((state.items[1] as { text: string }).text, 'Side note')
  })

  it('does not show reasoning that merely echoes the reply', () => {
    let state = reduceEvent(initialTranscript(), ev('message.delta', { text: 'Same text' }))
    state = reduceEvent(state, ev('reasoning.available', { text: 'Same text' }))
    assert.deepEqual(kinds(state), ['assistant'])
    state = reduceEvent(state, ev('reasoning.available', { text: 'Actual reasoning' }))
    assert.deepEqual(kinds(state), ['thinking', 'assistant'], 'reasoning goes in front of the reply it belongs to')
  })

  it('a reasoning event that arrives after the reply began never duplicates the reply', () => {
    // Seen on a real server: deltas, then reasoning.available, then message.complete.
    const reply = 'Short answer.\n\n- one\n- two'
    let state = reduceEvent(initialTranscript(), ev('message.start', {}))
    state = reduceEvent(state, ev('message.delta', { text: 'Short answer.\n\n' }))
    state = reduceEvent(state, ev('message.delta', { text: '- one\n- two' }))
    state = reduceEvent(state, ev('reasoning.available', { text: 'The user wants a sentence and a list; keep it brief.' }))
    state = reduceEvent(state, ev('message.complete', { text: reply, status: 'complete' }))

    const bubbles = state.items.filter(item => item.kind === 'assistant')
    assert.equal(bubbles.length, 1, 'one reply, not two')
    assert.equal((bubbles[0] as { text: string }).text, reply)
    assert.equal((bubbles[0] as { streaming: boolean }).streaming, false)
    assert.equal(state.items.at(-1)?.kind, 'assistant', 'the reply stays last')
  })

  it('reasoning in the middle of a reply does not split it', () => {
    let state = reduceEvent(initialTranscript(), ev('message.delta', { text: 'First half, ' }))
    state = reduceEvent(state, ev('reasoning.delta', { text: 'hmm' }))
    state = reduceEvent(state, ev('reasoning.delta', { text: ' ok' }))
    state = reduceEvent(state, ev('message.delta', { text: 'second half.' }))
    const bubbles = state.items.filter(item => item.kind === 'assistant')
    assert.equal(bubbles.length, 1)
    assert.equal((bubbles[0] as { text: string }).text, 'First half, second half.')
    const thinking = state.items.filter(item => item.kind === 'thinking')
    assert.deepEqual(thinking.map(item => (item as { text: string }).text), ['hmm ok'], 'streamed reasoning still joins up')
  })

  it('an echo of the reply that differs only in whitespace is still an echo', () => {
    let state = reduceEvent(initialTranscript(), ev('message.delta', { text: 'One.\n\nTwo.\n- a\n- b' }))
    state = reduceEvent(state, ev('reasoning.available', { text: 'One. Two. - a - b' }))
    assert.deepEqual(kinds(state), ['assistant'])
  })
})

describe('tool steps', () => {
  const start = (id: string, name = 'terminal', context = 'ls') => ev('tool.start', { tool_id: id, name, context })

  it('consecutive tool calls fold into one activity item', () => {
    let state = reduceEvent(initialTranscript(), start('a'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'terminal', result: { output: 'ok', exit_code: 0 }, duration_s: 1.2 }), NOW)
    state = reduceEvent(state, start('b', 'read_file', '/x/y.txt'), NOW)
    assert.deepEqual(kinds(state), ['activity'])
    const steps = (state.items[0] as Extract<Item, { kind: 'activity' }>).steps
    assert.deepEqual(steps.map(step => [step.toolId, step.state]), [['a', 'done'], ['b', 'running']])
    assert.equal(steps[0]?.durationS, 1.2)
    assert.equal(steps[0]?.resultLine, 'ok')
    assert.equal(steps[1]?.startedAt, NOW)
  })

  it('keeps the picture an image tool made, and only for that tool', () => {
    let state = reduceEvent(initialTranscript(), start('a', 'image_generate', 'a green triangle'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'image_generate', result: { success: true, image: 'https://cdn/x.png', host_image: '/h/x.png' }, duration_s: 3 }), NOW)
    state = reduceEvent(state, start('b'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'b', name: 'terminal', result: { success: true, image: '/tmp/not-from-the-image-tool.png', output: 'ok' } }), NOW)
    const steps = (state.items[0] as Extract<Item, { kind: 'activity' }>).steps
    assert.deepEqual(steps.map(step => step.image), ['/h/x.png', undefined])
  })

  it('keeps no picture from an image tool that failed', () => {
    let state = reduceEvent(initialTranscript(), start('a', 'image_generate'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'image_generate', result: { success: false, image: null, error: 'no key' } }), NOW)
    assert.equal((state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]?.image, undefined)
  })

  it('text between tool calls starts a new activity item', () => {
    let state = reduceEvent(initialTranscript(), start('a'))
    state = reduceEvent(state, ev('message.delta', { text: 'now this' }))
    state = reduceEvent(state, start('b'))
    assert.deepEqual(kinds(state), ['activity', 'assistant', 'activity'])
  })

  it('classifies failures by exit code or error', () => {
    const failed = (result: ToolResult) => {
      const s = reduceEvent(reduceEvent(initialTranscript(), start('a')), ev('tool.complete', { tool_id: 'a', name: 'terminal', result }))
      return (s.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]
    }
    assert.equal(failed({ output: 'boom', exit_code: 2 })?.state, 'failed')
    assert.equal(failed({ output: 'boom', exit_code: 2 })?.resultLine, 'boom')
    assert.equal(failed({ error: 'nope' })?.state, 'failed')
    assert.equal(failed({ output: 'fine', exit_code: 0 })?.state, 'done')
  })

  it('a repeated tool.start does not duplicate the step', () => {
    let state = reduceEvent(initialTranscript(), start('a'))
    state = reduceEvent(state, start('a'))
    assert.equal((state.items[0] as Extract<Item, { kind: 'activity' }>).steps.length, 1)
  })

  it('tool.complete without a start still shows a finished step', () => {
    const state = reduceEvent(initialTranscript(), ev('tool.complete', { tool_id: 'z', name: 'read_file', args: { path: '/a/b.txt' }, result: { output: 'x' } }))
    const step = (state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]
    assert.deepEqual([step?.state, step?.context], ['done', '/a/b.txt'])
  })
})

describe('prompts', () => {
  const approval = (id: string) => ev('approval.request', { command: 'rm -r /x', description: 'delete', request_id: id, choices: ['once', 'deny'] })

  it('adds an approval card once per request id', () => {
    let state = reduceEvent(initialTranscript(), approval('r1'))
    state = reduceEvent(state, approval('r1'))
    assert.equal(pendingPrompts(state).length, 1)
    assert.equal(state.running, true)
  })

  it('builds choices when the server sends none (approval.pending rows, old servers)', () => {
    const state = reduceEvent(initialTranscript(), ev('approval.request', { command: 'x', description: 'd', request_id: 'r', allow_session: false, allow_permanent: true }))
    assert.deepEqual((state.items[0] as { choices: string[] }).choices, ['once', 'always', 'deny'])
  })

  it('expire events and the end of the turn make prompts non-pending', () => {
    let state = reduceEvent(initialTranscript(), approval('r1'))
    state = reduceEvent(state, ev('approval.expire', { request_id: 'r1' }))
    assert.equal((state.items[0] as { state: string }).state, 'expired')

    state = reduceEvent(initialTranscript(), approval('r2'))
    state = reduceEvent(state, ev('message.complete', { text: '', status: 'interrupted' }))
    assert.equal((state.items[0] as { state: string }).state, 'expired')
  })

  it('normalizes the single-question form into questions', () => {
    const state = reduceEvent(initialTranscript(), ev('clarify.request', { request_id: 'q', question: 'Pick', choices: ['a', 'b'] }))
    const item = state.items[0] as Extract<Item, { kind: 'question' }>
    assert.deepEqual(item.questions, [{ question: 'Pick', choices: ['a', 'b'], multi_select: undefined }])
  })

  it('secret and sudo prompts carry no value, only what to ask for', () => {
    let state = reduceEvent(initialTranscript(), ev('secret.request', { request_id: 's1', prompt: 'API key', env_var: 'OPENAI_API_KEY' }))
    state = reduceEvent(state, ev('sudo.request', { request_id: 's2' }))
    assert.deepEqual(pendingPrompts(state).map(item => item.kind), ['secret', 'sudo'])
    assert.equal(JSON.stringify(state).includes('value'), false)
  })

  it('answerPrompt records the local choice; expirePrompt handles resolved: 0', () => {
    let state = reduceEvent(initialTranscript(), approval('r1'))
    state = answerPrompt(state, 'r1', { choice: 'session' })
    assert.deepEqual([(state.items[0] as { state: string }).state, (state.items[0] as { choice: string }).choice], ['answered', 'session'])
    // Answering twice keeps the first answer.
    assert.equal((answerPrompt(state, 'r1', { choice: 'deny' }).items[0] as { choice: string }).choice, 'session')

    let other = reduceEvent(initialTranscript(), approval('r9'))
    other = expirePrompt(other, 'r9')
    assert.equal((other.items[0] as { state: string }).state, 'expired')
  })
})

describe('local actions', () => {
  it('shows the user message at once and confirms it on message.start', () => {
    let state = appendUser(initialTranscript(), 'hello')
    assert.deepEqual([state.items[0]?.kind, (state.items[0] as { pending?: boolean }).pending, state.running], ['user', true, true])
    state = reduceEvent(state, ev('message.start', {}))
    assert.equal((state.items[0] as { pending?: boolean }).pending, false)
  })

  it('failUser drops the optimistic bubble and adds an error', () => {
    const state = failUser(appendUser(initialTranscript(), 'hello'), 'not connected')
    assert.deepEqual(kinds(state), ['error'])
    assert.equal(state.running, false)
  })

  it('shows what a slash command printed without touching a turn that is running', () => {
    const running = appendUser(initialTranscript(), 'start something')
    const state = appendOutput(running, '/status', '  Model: glm\n')
    assert.deepEqual(kinds(state), ['user', 'output'])
    assert.deepEqual(state.items[1], { kind: 'output', id: state.items[1]!.id, command: '/status', text: 'Model: glm' })
    assert.equal(state.running, true)
    assert.equal((appendOutput(initialTranscript(), '/usage', '   ').items[0] as { text: string }).text, '(no output)')
  })

  it('keeps the groups of names a command shows, and shows output that is only groups', () => {
    const state = appendOutput(initialTranscript(), '/help', 'Type /…', [{ title: 'Session', names: ['/new', '/undo'] }])
    const item = state.items[0] as { text: string; groups?: unknown }
    assert.deepEqual([item.text, item.groups], ['Type /…', [{ title: 'Session', names: ['/new', '/undo'] }]])
    assert.equal((appendOutput(initialTranscript(), '/help', '', [{ title: 'Session', names: ['/new'] }]).items[0] as { text: string }).text, '')
    assert.equal((appendOutput(initialTranscript(), '/x', '', []).items[0] as { text: string }).text, '(no output)')
  })

  it('shows a command as running until it answers', () => {
    const waiting = startOutput(appendUser(initialTranscript(), 'go'), '/reasoning')
    assert.deepEqual(waiting.items.at(-1) && (waiting.items.at(-1) as { pending?: boolean }).pending, true)
    assert.deepEqual(kinds(finishOutput(waiting)), ['user'])
    // Nothing waiting: nothing changes.
    const same = appendUser(initialTranscript(), 'go')
    assert.equal(finishOutput(same), same)
  })

  it('appendError says what went wrong with a command and leaves the turn alone', () => {
    const state = appendError(appendUser(initialTranscript(), 'go'), 'There is no command called /x.')
    assert.deepEqual(kinds(state), ['user', 'error'])
    assert.equal(state.running, true)
  })
})

describe('session events', () => {
  it('session.info running:false is a safety net that clears a stuck turn', () => {
    let state = reduceEvent(initialTranscript(), ev('message.start', {}))
    assert.equal(state.running, true)
    state = reduceEvent(state, ev('session.info', { model: 'm', provider: 'p', running: false }))
    assert.deepEqual([state.running, state.phase], [false, 'idle'])
  })

  it('status.update shows a status line that the end of the turn clears', () => {
    let state = reduceEvent(initialTranscript(), ev('status.update', { kind: 'lifecycle', text: 'Retrying in 2s…' }))
    assert.equal(state.statusLine, 'Retrying in 2s…')
    state = reduceEvent(state, ev('message.complete', { text: 'x', status: 'complete' }))
    assert.equal(state.statusLine, null)
  })

  it('ignores event types it does not handle', () => {
    const state = initialTranscript()
    assert.equal(reduceEvent(state, ev('sessions.changed', {})), state)
  })
})

describe('status line', () => {
  it('drops a leading emoji and folds line breaks', () => {
    assert.equal(quietStatus('👁 Hindsight — recalled 56 memories'), 'Hindsight — recalled 56 memories')
    assert.equal(quietStatus('⏳ Retrying in 2s…'), 'Retrying in 2s…')
    // The wake-up for a finished background process says nothing worth showing (its text is a command line).
    assert.equal(quietStatus('Background Process Finished: /home/orion/.hermes/tools/python3 /home/orion/x --run-delivery'), '')
    // Nor does the one for helpers' results: it lists every goal (the chat's note sums it up).
    assert.equal(quietStatus('Subagent Tasks Completed: Run the cart suite; Run the checkout suite; Run the search suite (3 tasks)'), '')
    assert.equal(quietStatus('Subagent Task Timed Out: Run the cart suite'), '')
    assert.equal(quietStatus('Recalled\n\n  three   things'), 'Recalled three things')
  })

  it('caps a paragraph-length status', () => {
    const long = quietStatus(`Recalled: ${'memory '.repeat(60)}`)
    assert.equal(long.length, 120)
    assert.ok(long.endsWith('…'))
  })

  it('keeps ordinary text, and a status that is only an emoji clears the line', () => {
    assert.equal(quietStatus('Searching the web'), 'Searching the web')
    let state = reduceEvent(initialTranscript(), ev('status.update', { kind: 'lifecycle', text: '⏳' }))
    assert.equal(state.statusLine, null)
    state = reduceEvent(state, ev('status.update', { kind: 'lifecycle', text: '🔎 Searching' }))
    assert.equal(state.statusLine, 'Searching')
  })
})

describe('the turn helpers’ results wake the bot for', () => {
  const wake = ev('status.update', { kind: 'process', text: 'Subagent Task Incomplete: Write the release notes' })

  it('is the bot reading the result, until that turn ends', () => {
    let state = reduceEvent(initialTranscript(), wake)
    assert.equal(state.wake, true)
    assert.equal(state.statusLine, null)
    state = reduceEvent(state, ev('message.start', {}))
    assert.deepEqual([state.running, state.wake], [true, true])
    state = reduceEvent(state, ev('message.complete', { text: 'The notes are drafted; one section is left.', status: 'complete' }))
    assert.deepEqual([state.running, state.wake], [false, false])
  })

  it('is over when the session goes idle, or when you send', () => {
    assert.equal(reduceEvent(reduceEvent(initialTranscript(), wake), ev('session.info', { model: 'm', provider: 'p', running: false })).wake, false)
    assert.equal(appendUser(reduceEvent(initialTranscript(), wake), 'and the changelog?', NOW).wake, false)
  })

  it('is only Hermes’s title for helpers’ results, not other process news', () => {
    assert.equal(reduceEvent(initialTranscript(), ev('status.update', { kind: 'process', text: 'Background Process Finished: npm test' })).wake, undefined)
    assert.equal(reduceEvent(initialTranscript(), ev('status.update', { kind: 'lifecycle', text: 'Subagent Task Completed: x' })).wake, undefined)
  })
})

describe('stopping a turn', () => {
  it('before any reply: a quiet stopped line, so the chat does not just end after your message', () => {
    let state = appendUser(initialTranscript(), 'count forever', NOW)
    state = reduceEvent(state, ev('message.start', {}))
    state = reduceEvent(state, ev('message.complete', { text: '', status: 'interrupted' }))
    assert.deepEqual(kinds(state), ['user', 'stopped'])
    assert.equal(state.running, false)
  })

  it('after a partial reply: the bubble keeps what was written and carries the status, no extra line', () => {
    let state = reduceEvent(initialTranscript(), ev('message.delta', { text: '1\n2\n3' }))
    state = reduceEvent(state, ev('message.complete', { text: '1\n2\n3', status: 'interrupted' }))
    assert.deepEqual(kinds(state), ['assistant'])
    assert.equal((state.items[0] as { status?: string }).status, 'interrupted')
  })

  it('a normal empty completion adds nothing', () => {
    const state = reduceEvent(initialTranscript(), ev('message.complete', { text: '', status: 'complete' }))
    assert.deepEqual(kinds(state), [])
  })
})

describe('a person holding the bot’s screen', () => {
  const held = JSON.stringify({ ok: false, action: 'screenshot', code: 'human_has_control', error: 'A human is driving this desktop.' })
  const start = (id: string, name = 'computer_use') => ev('tool.start', { tool_id: id, name, context: '' })

  it('computer_use refused because you hold the screen is a step waiting on you, not a failure', () => {
    let state = reduceEvent(initialTranscript(), start('a'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'computer_use', result: held }), NOW)
    const step = (state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]

    assert.equal(step?.state, 'blocked')
    assert.equal(step?.humanHasControl, true)
    assert.equal(step?.resultLine, 'Waiting for you to hand back the screen')
    assert.equal(step?.output, 'A human is driving this desktop.')
  })

  it('an object result with the same code is recognised too', () => {
    let state = reduceEvent(initialTranscript(), start('a'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'computer_use', result: { code: 'human_has_control', error: 'held' } as never }), NOW)

    assert.equal((state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]?.humanHasControl, true)
  })

  it('other JSON text from the tool, even mentioning the word, is not mistaken for it', () => {
    let state = reduceEvent(initialTranscript(), start('a'), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'computer_use', result: JSON.stringify({ ok: true, note: 'human_has_control is how a refusal looks' }) }), NOW)
    const step = (state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]

    assert.equal(step?.state, 'done')
    assert.equal(step?.humanHasControl, undefined)
  })

  it('plain text and malformed JSON are left alone', () => {
    for (const result of ['all good', '{ not json human_has_control']) {
      let state = reduceEvent(initialTranscript(), start('a'), NOW)
      state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'terminal', result }), NOW)

      assert.equal((state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]?.humanHasControl, undefined)
    }
  })
})

describe('which non-zero exits are failures', () => {
  const ran = (command: string, exit_code: number) => {
    let state = reduceEvent(initialTranscript(), ev('tool.start', { tool_id: 'a', name: 'terminal', context: command, args: { command } }), NOW)
    state = reduceEvent(state, ev('tool.complete', { tool_id: 'a', name: 'terminal', args: { command }, result: { output: 'x', exit_code } }), NOW)

    return (state.items[0] as Extract<Item, { kind: 'activity' }>).steps[0]
  }

  it('a command ended by a signal is not a failure: the pkill that killed its own shell', () => {
    const step = ran("pkill -f 'user-data-dir=/tmp/chrome-profile'", -15)
    assert.equal(step?.state, 'done')
    assert.equal(step?.exitCode, -15, 'the code is kept, for the quiet note')
  })

  it('exit 1 from a search or comparison is an answer, in a pipeline or not', () => {
    for (const command of ['pgrep -af chrome-profile', "ps -eo pid,cmd | grep -c 'chrome-profile'", 'diff a.txt b.txt', 'test -f /tmp/x', 'which xdotool', 'cd /tmp && grep -q needle haystack']) {
      assert.equal(ran(command, 1)?.state, 'done', command)
    }
  })

  it('but a real failure stays one: other exit codes, and exit 1 from anything else', () => {
    assert.equal(ran('ls /nonexistent', 2)?.state, 'failed')
    assert.equal(ran('npm test', 1)?.state, 'failed')
    assert.equal(ran('curl -sf http://127.0.0.1:9222', 7)?.state, 'failed')
    assert.equal(ran('grep -q x file', 2)?.state, 'failed', 'grep exit 2 is an error, only 1 means no match')
    assert.equal(ran('make build', 137)?.state, 'failed', 'a kill by the OOM killer is still a failure')
  })

  it('a program whose NAME merely contains one of those words is not mistaken for it', () => {
    assert.equal(ran('./grepper --run', 1)?.state, 'failed')
    assert.equal(ran('mytest-runner', 1)?.state, 'failed')
  })

  it('SIGTERM as the shell reports it (143) is not a failure either', () => {
    assert.equal(ran('sleep 100', 143)?.state, 'done')
  })

  it('nor is an interrupted command (130): you stopped it, or a new message did', () => {
    assert.equal(ran('echo waiting; sleep 600', 130)?.state, 'done')
  })

  it('a tool error with no exit code is a failure', () => {
    assert.equal(isRealFailure({ state: 'failed' }, 'anything'), true)
  })

  it('a step that did not fail is left alone', () => {
    assert.equal(isRealFailure({ state: 'done', exitCode: 1 }, 'grep x'), false)
  })
})

describe('exitSetter', () => {
  it('is the last command of a chain or pipeline, past prefixes', () => {
    assert.equal(exitSetter('pgrep -af chrome'), 'pgrep')
    assert.equal(exitSetter("ps -eo pid,cmd | grep -c 'chrome-profile'"), 'grep')
    assert.equal(exitSetter('cd /tmp && grep -q needle haystack'), 'grep')
    assert.equal(exitSetter('sleep 1; pgrep -af x'), 'pgrep')
    assert.equal(exitSetter('export DISPLAY=:1; xdotool search --class chrome'), 'xdotool')
    assert.equal(exitSetter('DISPLAY=:1 sudo grep x y'), 'grep')
    assert.equal(exitSetter('npm test'), 'npm')
    assert.equal(exitSetter(''), '')
  })

  it('does not split on separators inside quotes', () => {
    assert.equal(exitSetter("grep 'a|b; c && d' file"), 'grep')
    assert.equal(exitSetter('echo "x | y"'), 'echo')
  })
})

describe('a turn between bots that was running when the chat opened', () => {
  const start = { ...initialTranscript([{ kind: 'user', id: 'h-1', text: 'hi' }]), chatterFrom: 1, running: true }

  it('flags what it wrote as chatter once the turn is over', () => {
    let state = reduceEvent(start, { type: 'message.delta', payload: { text: 'Ping received.' } } as HermesEvent)
    state = reduceEvent(state, { type: 'message.complete', payload: { text: 'Ping received.', status: 'complete' } } as HermesEvent)
    assert.deepEqual(state.items.map(item => [item.kind, !!item.chatter]), [['user', false], ['assistant', true]])
    assert.equal(state.chatterFrom, null)
  })

  it('flags it when you send, so none of it surfaces afterwards', () => {
    const state = appendUser(reduceEvent(start, { type: 'message.delta', payload: { text: 'Ping' } } as HermesEvent), 'hello again')
    assert.deepEqual(state.items.map(item => [item.kind, !!item.chatter]), [['user', false], ['assistant', true], ['user', false]])
    assert.equal(state.chatterFrom, null)
  })
})

describe('what an edit step changed', () => {
  it('keeps a patch result’s diff and the file it wrote', () => {
    const read = readResult({ success: true, diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n', files_modified: ['/home/orion/x'] } as never)
    assert.equal(read.file, '/home/orion/x')
    assert.match(read.diff ?? '', /^--- a\/x/)
  })

  it('reads the stored JSON text form too, and write_file’s resolved path', () => {
    assert.equal(readResult(JSON.stringify({ bytes_written: 12, resolved_path: '/home/orion/notes.md', files_modified: ['/home/orion/notes.md'] })).file, '/home/orion/notes.md')
  })

  it('gives nothing for a failed edit or a relative path', () => {
    assert.equal(readResult({ success: false, error: 'Found 27 matches', diff: 'x' } as never).diff, undefined)
    assert.equal(readResult({ files_modified: ['notes.md'] } as never).file, undefined)
  })
})

describe('appendNote', () => {
  it('adds a quiet line between turns, and never during one', () => {
    const idle = appendNote(initialTranscript(), 'Call started 10:41', 5)

    assert.deepEqual(idle.items.at(-1), { kind: 'note', id: 'n-1', text: 'Call started 10:41', ts: 5 })

    const running = appendUser(initialTranscript(), 'Check my calendar')

    assert.equal(appendNote(running, 'Call started 10:41'), running)
  })
})
