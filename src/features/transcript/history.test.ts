import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { MessagesPage, StoredMessage } from '../../lib/hermes/rest.ts'
import { summarizeActivity } from './activity.ts'
import { historyWithOpenTurn, itemsFromHistory, settleStaleSteps, turnIsChatter } from './history.ts'
import { dashboardButton, deliveryTarget, messageAgentTarget, noteFor, profileOfHandle, routineDelivery, routineNote, teammateMessage } from './injected.ts'
import type { Item } from './types.ts'

const page = JSON.parse(readFileSync(new URL('../../../docs/protocol-captures/messages.json', import.meta.url), 'utf8')) as MessagesPage

describe('itemsFromHistory (captured transcript)', () => {
  const items = itemsFromHistory(page.messages)

  it('produces user, assistant and folded activity items in order', () => {
    const kinds = items.map(item => item.kind)
    assert.equal(kinds[0], 'user')
    assert.ok(kinds.includes('activity'))
    // No two activity items sit side by side, and no tool rows leak through as bubbles.
    for (let i = 1; i < kinds.length; i++) {
      assert.ok(!(kinds[i] === 'activity' && kinds[i - 1] === 'activity'))
    }
    assert.equal(items.filter(item => item.kind === 'user').length, page.messages.filter(m => m.role === 'user').length)
  })

  it('pairs the denied approval step with its result', () => {
    const steps = items.flatMap(item => (item.kind === 'activity' ? item.steps : []))
    const terminal = steps.find(step => step.name === 'terminal')
    assert.ok(terminal)
    assert.equal(terminal.state, 'blocked')
    assert.match(terminal.context, /^rm -r \/tmp\/hermesbot-smoke-/)
    assert.equal(terminal.resultLine, 'Denied')
    assert.ok(terminal.durationS !== undefined && terminal.durationS >= 0)
  })

  it('assigns stable ids from the row ids', () => {
    assert.ok(items.every(item => item.id.startsWith('h-')))
    assert.equal(new Set(items.map(item => item.id)).size, items.length)
  })
})

describe('itemsFromHistory (edge cases)', () => {
  const row = (partial: Partial<StoredMessage> & Pick<StoredMessage, 'id' | 'role'>): StoredMessage => ({ content: null, ...partial })

  it('skips hidden and system rows and prefers display_content', () => {
    const items = itemsFromHistory([
      row({ id: 1, role: 'system', content: 'sys' }),
      row({ id: 2, role: 'user', content: 'ctx', display_kind: 'hidden' }),
      row({ id: 3, role: 'user', content: '/skill do-it', display_content: 'Do it' }),
    ])
    assert.deepEqual(items.map(item => (item.kind === 'user' ? item.text : null)), ['Do it'])
  })

  it('reads a batch of tool calls issued together as the time it took, not the sum of each call’s own time', () => {
    const call = (id: string, name: string) => ({ id, function: { name, arguments: '{}' } })
    const items = itemsFromHistory([
      row({ id: 1, role: 'assistant', content: '', timestamp: 1000, tool_calls: [call('a', 'skill_view'), call('b', 'skill_view'), call('c', 'hindsight_recall')] }),
      row({ id: 2, role: 'tool', tool_call_id: 'a', content: 'ok', timestamp: 1007 }),
      row({ id: 3, role: 'tool', tool_call_id: 'b', content: 'ok', timestamp: 1007 }),
      row({ id: 4, role: 'tool', tool_call_id: 'c', content: 'ok', timestamp: 1094 }),
    ])
    const steps = (items[0] as Extract<Item, { kind: 'activity' }>).steps

    assert.deepEqual(steps.map(step => step.durationS), [7, 7, 94])
    assert.equal(summarizeActivity(steps).title, 'Ran 3 steps · 1m 34s')
  })

  it('keeps the picture an image tool made when the chat is read back from the server', () => {
    const items = itemsFromHistory([
      row({ id: 1, role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'image_generate', arguments: '{"prompt":"a green triangle"}' } }] }),
      row({ id: 2, role: 'tool', tool_call_id: 'c1', content: '{"success": true, "image": "/h/tri.png", "host_image": "/h/tri.png"}' }),
    ])
    const step = (items[0] as Extract<Item, { kind: 'activity' }>).steps[0]
    assert.equal(step?.image, '/h/tri.png')
  })

  it('shows a skill you started as what you typed, not as a note from the server', () => {
    const stored = ['[IMPORTANT: The user has invoked the "work" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]', '', '# Work', '', 'The user has provided the following instruction alongside the skill invocation: fix the leak'].join('\n')
    const items = itemsFromHistory([row({ id: 1, role: 'user', content: stored }), row({ id: 2, role: 'assistant', content: 'On it.' })])
    assert.deepEqual(items.map(item => (item.kind === 'user' || item.kind === 'assistant' ? item.text : item.kind)), ['/work fix the leak', 'On it.'])
    assert.equal(noteFor(row({ id: 1, role: 'user', content: stored })), null)
  })

  it('still shows the server’s own [IMPORTANT: …] wake-ups as notes', () => {
    const items = itemsFromHistory([row({ id: 1, role: 'user', content: '[IMPORTANT: Background process proc_1 completed normally (exit code 0). Command: ls]' })])
    assert.deepEqual(items.map(item => item.kind), ['note'])
  })

  it('shows an assistant message that has both text and tool calls as a bubble then a step', () => {
    const items = itemsFromHistory([
      row({ id: 1, role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"/a/b.txt"}' } }] }),
      row({ id: 2, role: 'tool', tool_call_id: 'c1', content: 'file contents' }),
    ])
    assert.deepEqual(items.map(item => item.kind), ['assistant', 'activity'])
    const step = (items[1] as Extract<Item, { kind: 'activity' }>).steps[0]
    assert.deepEqual([step?.context, step?.state, step?.resultLine], ['/a/b.txt', 'done', 'file contents'])
  })

  it('merges parallel tool calls into one activity item', () => {
    const items = itemsFromHistory([
      row({
        id: 1,
        role: 'assistant',
        tool_calls: [
          { id: 'a', function: { name: 'terminal', arguments: '{"command":"ls"}' } },
          { id: 'b', function: { name: 'terminal', arguments: '{"command":"pwd"}' } },
        ],
      }),
    ])
    assert.equal((items[0] as Extract<Item, { kind: 'activity' }>).steps.length, 2)
  })

  it('tolerates unparseable arguments and results', () => {
    const items = itemsFromHistory([
      row({ id: 1, role: 'assistant', tool_calls: [{ id: 'a', function: { name: 'terminal', arguments: 'not json' } }] }),
      row({ id: 2, role: 'tool', tool_call_id: 'a', content: 'plain text result' }),
    ])
    const step = (items[0] as Extract<Item, { kind: 'activity' }>).steps[0]
    assert.deepEqual([step?.context, step?.state], ['', 'done'])
  })
})

describe('settleStaleSteps', () => {
  it('turns a step with no result into a stopped one', () => {
    const items = itemsFromHistory([row('a')])
    const settled = settleStaleSteps(items)
    const step = (settled[0] as Extract<Item, { kind: 'activity' }>).steps[0]
    assert.deepEqual([step?.state, step?.resultLine], ['failed', 'Stopped'])

    function row(id: string): StoredMessage {
      return { id: 1, role: 'assistant', content: null, tool_calls: [{ id, function: { name: 'terminal', arguments: '{}' } }] }
    }
  })
})

describe('stopped replies', () => {
  const row = (id: number, extra: Partial<StoredMessage>): StoredMessage => ({ id, role: 'assistant', content: 'text', ...extra })

  it('marks a stored reply with an explicit null finish reason as stopped', () => {
    const items = itemsFromHistory([row(1, { finish_reason: null })])
    assert.equal((items[0] as { status?: string }).status, 'interrupted')
  })

  it('leaves finished replies, tool-call rows and rows with no finish reason field alone', () => {
    const items = itemsFromHistory([row(1, { finish_reason: 'stop' }), row(2, { finish_reason: null, tool_calls: [{ id: 'c', function: { name: 'terminal', arguments: '{}' } }] }), row(3, {})])
    const replies = items.filter(item => item.kind === 'assistant') as { status?: string }[]
    assert.deepEqual(replies.map(reply => reply.status), [undefined, undefined, undefined])
  })
})

describe('a screen held by a person, from stored history', () => {
  it('marks the step that was refused', () => {
    const rows: StoredMessage[] = [
      { id: 1, role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'computer_use', arguments: '{"action":"screenshot"}' } }] },
      { id: 2, role: 'tool', content: JSON.stringify({ ok: false, action: 'screenshot', code: 'human_has_control', error: 'held' }), tool_call_id: 'c1' },
    ]
    const step = (itemsFromHistory(rows)[0] as Extract<Item, { kind: 'activity' }>).steps[0]

    assert.equal(step?.humanHasControl, true)
    assert.equal(step?.state, 'blocked')
  })
})

describe('exits in stored history', () => {
  const tool = (id: number, command: string, exit_code: number): StoredMessage[] => [
    { id, role: 'assistant', content: '', tool_calls: [{ id: `c${id}`, function: { name: 'terminal', arguments: JSON.stringify({ command }) } }] },
    { id: id + 100, role: 'tool', content: JSON.stringify({ output: '', exit_code }), tool_call_id: `c${id}` },
  ]

  it('a signal exit and a no-match search are finished steps; a real failure still fails', () => {
    const items = itemsFromHistory([...tool(1, "pkill -f 'user-data-dir=/tmp/x'", -15), ...tool(2, 'pgrep -af chrome', 1), ...tool(3, 'ls /nope', 2)])
    const steps = (items[0] as Extract<Item, { kind: 'activity' }>).steps

    assert.deepEqual(steps.map(step => step.state), ['done', 'done', 'failed'])
  })
})

describe('messages stored as user turns that you did not write', () => {
  const row = (patch: Partial<StoredMessage> & { display_metadata?: unknown }): StoredMessage => ({ id: 1, role: 'user', content: 'x', timestamp: 100, ...patch }) as StoredMessage

  it('draws a finished background process as one quiet line, not your message and not its command', () => {
    const items = itemsFromHistory([
      row({
        id: 7,
        content: '[IMPORTANT: Background process proc_1 completed normally (exit code 0).\nCommand: /home/orion/.hermes/tools/python3 bot_mode_dm.py --run-delivery\n]',
        display_kind: 'process_complete',
        display_metadata: { display_text: 'Background Process Finished: /home/orion/.hermes/tools/python3 …' },
      }),
    ])
    // A bot-to-bot delivery's wake-up is plumbing: marked so the chat leaves it out.
    assert.deepEqual(items, [{ kind: 'note', id: 'h-7', text: 'Background process finished', ts: 100_000, chatter: true }])
  })

  it('uses the server’s own short text for other typed rows, and a plain default without one', () => {
    const items = itemsFromHistory([
      row({ id: 1, display_kind: 'async_delegation_complete', display_metadata: JSON.stringify({ display_text: '2 background agents finished' }) }),
      row({ id: 2, display_kind: 'model_switch' }),
    ])
    assert.deepEqual(items.map(item => (item.kind === 'note' ? item.text : item.kind)), ['2 background agents finished', 'Model changed'])
  })

  it('sums up helpers’ results in one line instead of every goal (rows as Hermes 0.22.2 stores them)', () => {
    const stored = {
      display_text: 'Subagent Tasks Completed: Run the cart suite: sleep 30 then npm test; Run the checkout suite: sleep 150 then npm test; Run the search suite: sleep 300 then npm test (3 tasks)',
      delegation_id: 'deleg_ae270726',
      task_count: 3,
      completed_count: 3,
      failed_count: 0,
      duration_seconds: 302.43,
    }
    const helpers = (meta: Record<string, unknown>) => noteFor(row({ display_kind: 'async_delegation_complete', display_metadata: JSON.stringify(meta), content: '[ASYNC DELEGATION BATCH COMPLETE — deleg_ae270726]\n…' }))

    assert.equal(helpers(stored), '3 helpers finished · 5m 2s')
    assert.equal(helpers({ ...stored, display_text: 'Subagent Tasks Finished with Issues: a; b; c (3 tasks)', completed_count: 2, failed_count: 1 }), '3 helpers finished · 1 failed · 5m 2s')
    assert.equal(helpers({ ...stored, display_text: 'Subagent Tasks Failed: a; b; c (3 tasks)', completed_count: 0, failed_count: 3, duration_seconds: undefined }), '3 helpers failed')
    assert.equal(helpers({ display_text: 'Subagent Task Timed Out: Run the cart suite', task_count: 1, failed_count: 0, duration_seconds: 600 }), 'A helper timed out · 10m 0s')
    assert.equal(helpers({ display_text: 'Subagent Task Interrupted: Run the cart suite', task_count: 1 }), 'A helper was stopped')
    // A short text of the server's own (an older server) is kept as it is.
    assert.equal(helpers({ display_text: '2 background agents finished' }), '2 background agents finished')
  })

  it('recognises helpers’ results by their wording when the row has no label', () => {
    const batch = '[ASYNC DELEGATION BATCH COMPLETE — deleg_1]\nA background fan-out unit you dispatched earlier — 3 subagent(s) — has finished.\n--- ✓ TASK 1/3: a  (status=completed)\n--- ✗ TASK 2/3: b  (status=failed)\n--- ✓ TASK 3/3: c  (status=completed)'
    assert.equal(noteFor(row({ content: batch })), '3 helpers finished · 1 failed')
    assert.equal(noteFor(row({ content: '[ASYNC DELEGATION COMPLETE — deleg_2]\nStatus: completed   API calls: 2   Duration: 18s' })), 'A helper finished')
    assert.equal(noteFor(row({ content: '[ASYNC DELEGATION COMPLETE — deleg_2]\nStatus: failed   API calls: 2   Duration: 18s' })), 'A helper failed')
    assert.equal(noteFor(row({ content: '[ASYNC DELEGATION TASK FAILED — deleg_3, task 2/3]\nStatus: failed' })), 'A helper failed')
    assert.deepEqual(itemsFromHistory([row({ id: 5, content: batch })]).map(item => item.kind), ['note'])
  })

  it('draws another bot’s message from the sender, without the delivery prefix', () => {
    const items = itemsFromHistory([row({ id: 3, content: 'Message from 🤖 juniper (@juniper): Juniper got the ping.\nAll quiet.' })])
    assert.deepEqual(items, [{ kind: 'teammate', id: 'h-3', handle: 'juniper', text: 'Juniper got the ping.\nAll quiet.', ts: 100_000, chatter: true }])
  })

  it('reads the older delivery prefix, and the default profile’s handle', () => {
    assert.deepEqual(teammateMessage("Message from agent 'Forge': hello"), { handle: 'forge', text: 'hello' })
    assert.deepEqual(teammateMessage('Message from 🤖 Orion (@hermes): done'), { handle: 'hermes', text: 'done' })
    assert.equal(profileOfHandle('hermes'), 'default')
    assert.equal(profileOfHandle('juniper'), 'juniper')
  })

  it('recognises a wake-up by its wording when the server gave it no label (Juniper’s chat on Hermes 0.21.6)', () => {
    const wake = (status: string) => row({ id: 9, content: `[IMPORTANT: Background process proc_1 ${status} (exit code 0).\nCommand: /home/orion/x --run-delivery\nOutput:\n{"reply": "ok"}\n]` })
    assert.equal(noteFor(wake('completed normally')), 'Background process finished')
    assert.equal(noteFor(wake('exited')), 'Background process exited with an error')
    assert.equal(noteFor(wake('terminated by Hermes')), 'Background process was stopped')
    assert.equal(noteFor(row({ content: '[IMPORTANT: Background process proc_2 matched watch pattern "ready".\nCommand: x\nMatched output:\nready]' })), 'Background process matched a pattern')
    assert.equal(noteFor(row({ content: '[IMPORTANT: Too many matches, watching paused.]' })), 'Too many matches, watching paused.')
    assert.deepEqual(itemsFromHistory([wake('completed normally')]).map(item => item.kind), ['note'])
  })

  it('leaves what you typed alone, even if it mentions these words', () => {
    assert.equal(teammateMessage('Please send a Message from me to juniper'), null)
    assert.equal(teammateMessage('Message from 🤖 juniper (@juniper):'), null)
    assert.equal(noteFor(row({ display_kind: 'steer' })), null)
    assert.equal(noteFor(row({ display_kind: 'skill_invocation' })), null)
    assert.equal(noteFor(row({ content: 'The [IMPORTANT: part] is in the middle' })), null)
    assert.deepEqual(itemsFromHistory([row({ id: 4, content: 'hello' })]).map(item => item.kind), ['user'])
  })
})

describe('conversations between bots (rows as stored on Hermes 0.21.6)', () => {
  let n = 0
  const base = { timestamp: 100 }
  const typed = (text: string): StoredMessage => ({ ...base, id: ++n, role: 'user', content: text }) as StoredMessage
  const said = (text: string): StoredMessage => ({ ...base, id: ++n, role: 'assistant', content: text }) as StoredMessage
  const dm = (from: string, text: string): StoredMessage => typed(`Message from 🤖 ${from} (@${from}): ${text}`)
  const send = (target: string): StoredMessage =>
    ({ ...base, id: ++n, role: 'assistant', content: '', tool_calls: [{ id: `c${n}`, function: { name: 'message_agent', arguments: JSON.stringify({ target, message: 'hi' }) } }] }) as StoredMessage
  const sent = (callId: string): StoredMessage => ({ ...base, id: ++n, role: 'tool', tool_call_id: callId, tool_name: 'message_agent', content: '{"status":"queued"}' }) as StoredMessage
  const wake = (profile: string): StoredMessage =>
    typed(`[IMPORTANT: Background process proc_1 completed normally (exit code 0).\nCommand: /usr/bin/python3 /h/tools/bot_mode_dm.py --run-delivery --author '{"id":"bot:x"}' query-file /tmp/dm.txt --profile-home /h/profiles/${profile} /h/bin/hermes -p ${profile} chat --in '~' -c 'Bot Chat' --create-if-missing -Q\nOutput:\nok\n]`)
  const shown = (rows: StoredMessage[]) => itemsFromHistory(rows).filter(item => !item.chatter).map(item => (item.kind === 'assistant' || item.kind === 'user' ? `${item.kind}:${item.text}` : item.kind))

  it('hides the whole turn another bot started in the bot that received it (Juniper’s chat)', () => {
    const rows = [
      typed('Another'),
      said('Sent. test-note'),
      dm('Orion', 'Alex asked for a live agent-DM test.'),
      send('hermes'),
      sent('c4'),
      said('Ping received. Relayed to Orion.'),
      wake('default'),
      said('Orion (@hermes): Juniper got the ping.'),
    ]
    assert.deepEqual(shown(rows), ['user:Another', 'assistant:Sent. test-note'])
  })

  it('keeps what a bot says to the person after it messaged another bot for them (Orion’s chat)', () => {
    const rows = [typed('Talk direct to juniper'), said('Sending Juniper a DM now.'), send('juniper'), sent('c3'), said('Pinged Juniper. Delivery is queued.'), dm('juniper', 'Juniper got the ping.'), said('Juniper got the ping. Direct DM worked.'), wake('juniper'), said('Juniper says all is well.')]
    assert.deepEqual(shown(rows), ['user:Talk direct to juniper', 'assistant:Sending Juniper a DM now.', 'activity', 'assistant:Pinged Juniper. Delivery is queued.', 'assistant:Juniper says all is well.'])
  })

  it('shows the report in the normal case, where the answer comes back only as the wake-up', () => {
    const rows = [typed('Ask juniper for the disk space'), send('juniper'), sent('c2'), said('Asked Juniper.'), wake('juniper'), said('Juniper says the disk is 80% full.')]
    assert.deepEqual(shown(rows), ['user:Ask juniper for the disk space', 'activity', 'assistant:Asked Juniper.', 'assistant:Juniper says the disk is 80% full.'])
  })

  it('pairs each wake-up with the message it answers, even when two are out at once', () => {
    const rows = [typed('Ask juniper and scout'), send('juniper'), sent('c2'), send('scout'), sent('c4'), said('Asked both.'), wake('scout'), said('Scout is done.'), wake('juniper'), said('Juniper is done.')]
    assert.deepEqual(shown(rows).filter(entry => entry.startsWith('assistant')), ['assistant:Asked both.', 'assistant:Scout is done.', 'assistant:Juniper is done.'])
  })

  it('marks everything between bots rather than dropping it, so it can be shown on request', () => {
    const items = itemsFromHistory([typed('hi'), dm('Orion', 'ping'), said('pong')])
    assert.deepEqual(items.map(item => [item.kind, !!item.chatter]), [['user', false], ['teammate', true], ['assistant', true]])
  })

  it('leaves a wake-up for something that is not a bot message alone', () => {
    const rows = [typed('build it'), said('Started the build.'), typed('[IMPORTANT: Background process proc_9 completed normally (exit code 0).\nCommand: make all\nOutput: done]'), said('The build finished.')]
    assert.deepEqual(shown(rows), ['user:build it', 'assistant:Started the build.', 'note', 'assistant:The build finished.'])
  })

  it('shows a turn when it cannot tell (the message it answers is older than the page that was read)', () => {
    assert.deepEqual(shown([said('earlier'), wake('juniper'), said('Juniper replied.')]), ['assistant:earlier', 'assistant:Juniper replied.'])
  })

  it('does not let a peer or relay message be mistaken for a local one', () => {
    const rows = [typed('ask the cloud one'), { ...send('peer/researcher') }, sent('c3'), said('Asked.'), wake('juniper'), said('Done.')]
    assert.deepEqual(shown(rows).filter(entry => entry.startsWith('assistant')), ['assistant:Asked.', 'assistant:Done.'])
  })
})

describe('a routine’s output handed to the bot (deliver: bot-chat, as such rows are stored on Hermes 0.21.5)', () => {
  let n = 0
  const base = { timestamp: 100 }
  const typed = (text: string): StoredMessage => ({ ...base, id: ++n, role: 'user', content: text }) as StoredMessage
  const said = (text: string): StoredMessage => ({ ...base, id: ++n, role: 'assistant', content: text }) as StoredMessage
  const call = (name: string): StoredMessage => ({ ...base, id: ++n, role: 'assistant', content: '', tool_calls: [{ id: `c${n}`, function: { name, arguments: '{"command":"ls"}' } }] }) as StoredMessage
  const result = (): StoredMessage => ({ ...base, id: ++n, role: 'tool', tool_call_id: `c${n - 1}`, content: '{"output":"ok","exit_code":0}' }) as StoredMessage
  const routine = (job: string) =>
    typed(`[Cronjob "${job}" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\nAll checks passed. Summary:\n\n**Checks**`)
  const shown = (rows: StoredMessage[]) => itemsFromHistory(rows).filter(item => !item.chatter).map(item => (item.kind === 'assistant' || item.kind === 'user' || item.kind === 'note' ? `${item.kind}:${item.text}` : item.kind))

  it('shows that the routine ran and the bot’s summary, never the raw output or the bot working on it', () => {
    const rows = [
      typed('How did the jobs go?'),
      said('Both jobs are still there.'),
      routine('weekly-status-report'),
      said('The job says it finished. Checking before I pass that on.'),
      call('terminal'),
      result(),
      said('Verified against the run records.'),
      call('read_file'),
      result(),
      said('This week’s report is in Drive: two links still need fixing.'),
    ]

    assert.deepEqual(shown(rows), [
      'user:How did the jobs go?',
      'assistant:Both jobs are still there.',
      'note:Routine “Weekly status report” ran',
      'assistant:This week’s report is in Drive: two links still need fixing.',
    ])
  })

  it('keeps the bot working marked rather than dropped, so it can be shown on request', () => {
    const items = itemsFromHistory([routine('nightly'), said('Checking.'), call('terminal'), result(), said('All good.')])
    assert.deepEqual(items.map(item => [item.kind, !!item.chatter]), [['note', false], ['assistant', true], ['activity', true], ['assistant', false]])
  })

  it('ends the routine’s turn at the next message, showing its summary there too', () => {
    const rows = [routine('nightly'), said('Looking.'), said('Nightly ran clean.'), typed('thanks'), said('Any time.')]
    assert.deepEqual(shown(rows), ['note:Routine “Nightly” ran', 'assistant:Nightly ran clean.', 'user:thanks', 'assistant:Any time.'])
  })

  it('a routine turn with no reply shows only that it ran', () => {
    assert.deepEqual(shown([routine('nightly'), call('terminal'), result()]), ['note:Routine “Nightly” ran'])
  })

  it('a routine turn cut off while the bot was still working shows only that it ran, not its working words', () => {
    // A routine turn cut short by a restart: the bot said this on the way to a tool, and never got to its summary.
    const working = { ...said('The job says it finished. Checking first.'), tool_calls: [{ id: 'c-v', function: { name: 'terminal', arguments: '{"command":"ls"}' } }] } as StoredMessage
    const done = { id: ++n, role: 'tool', tool_call_id: 'c-v', content: '{"output":"ok","exit_code":0}', timestamp: 100 } as StoredMessage
    assert.deepEqual(shown([routine('weekly-status-report'), working, done]), ['note:Routine “Weekly status report” ran'])
  })

  it('leaves the routine’s turn open while it may still be running: nothing of it shows yet', () => {
    const { items, routineFrom } = historyWithOpenTurn([typed('hi'), routine('nightly'), said('Checking first.')])
    assert.equal(routineFrom, 2)
    assert.deepEqual(items.filter(item => !item.chatter).map(item => item.kind), ['user', 'note'])
    assert.equal(turnIsChatter([typed('hi'), routine('nightly')]), true)
  })

  it('reads the job name, and nothing that only looks similar', () => {
    assert.equal(routineDelivery('[Cronjob "weekly-team-digest" output — scheduled job, not the user.]\nbody'), 'weekly-team-digest')
    assert.equal(routineDelivery('Can you check the [Cronjob "x" output] for me?'), null)
    assert.equal(routineDelivery('[Cronjob "my "quoted" job" output — scheduled job, not the user.]'), 'my "quoted" job')
    assert.equal(routineDelivery('[Cronjob "x" output — please summarize]'), null, 'only the wording Hermes uses')
    assert.equal(routineNote('[bot:courier] Weekly team digest'), 'Routine “Weekly team digest” ran')
    assert.equal(routineNote('monthly-backup-check'), 'Routine “Monthly backup check” ran')
    assert.equal(routineNote(''), 'A routine ran')
  })

  it('reads a dashboard button’s message: the button, the record and the draft’s first line', () => {
    const message = '[Dashboard button "Send reply" · Late delivery, Order 4]\nYour person pressed "Send reply"…\n\nDraft reply (use it exactly as written):\n"""\nHi Sam, Thursday works.\nThanks!\n"""\n\nWhen you are done…'
    assert.deepEqual(dashboardButton(message), { label: 'Send reply', title: 'Late delivery, Order 4', draft: 'Hi Sam, Thursday works.' })
    assert.deepEqual(dashboardButton('[Dashboard button "Book it" · Furnace service]\nDo it.'), { label: 'Book it', title: 'Furnace service', draft: null })
    assert.equal(dashboardButton('Please press [Dashboard button "x" · y] for me'), null)
  })
})

describe('fixed texts the server stores as user turns', () => {
  it('a turn that ran out of steps shows a quiet line, not a bubble from you', () => {
    const rows = [
      { id: 1, role: 'user', content: 'install the plugins' },
      { id: 2, role: 'assistant', content: 'Working on it.' },
      { id: 3, role: 'user', content: "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response summarizing what you've found and accomplished so far, without calling any more tools." },
      { id: 4, role: 'assistant', content: 'Stopped before doing anything.' },
    ] as StoredMessage[]
    const items = itemsFromHistory(rows)
    assert.deepEqual(items.map(item => item.kind), ['user', 'assistant', 'note', 'assistant'])
    assert.equal((items[2] as { text: string }).text, 'Reached its step limit for one turn')
  })

  it('your request copied back in after a compaction is one quiet line, not a second bubble from you', () => {
    // As Hermes 0.21.5 stores it: a plain user row, the header and then your words.
    const asked = 'Write up the release notes for the checkout update'
    const restated = { id: 7, role: 'user', content: `[STILL IN PROGRESS — this is the active request, restated after the compaction boundary because it was not finished yet. Continue it; do not start over.]\n${asked}` } as StoredMessage
    assert.equal(noteFor(restated), 'Chat compacted · picked your last request back up')
    assert.deepEqual(itemsFromHistory([{ id: 6, role: 'user', content: asked } as StoredMessage, restated]).map(item => item.kind), ['user', 'note'])
  })
})

describe('reading bot-to-bot plumbing', () => {
  it('reads who a delivery was addressed to, and ignores anything else', () => {
    assert.equal(deliveryTarget("Command: x/bot_mode_dm.py --run-delivery --author '{}' query-file /t --profile-home /p hermes -p juniper chat --in '~' -c 'Bot Chat'"), 'juniper')
    assert.equal(deliveryTarget('Command: x/bot_mode_dm.py --run-delivery stdin /t hermes -p default peer dm cloudbox'), undefined)
    assert.equal(deliveryTarget('Command: make all'), null)
  })

  it('reads a message_agent target, with the default profile as hermes', () => {
    assert.equal(messageAgentTarget({ target: 'hermes' }), 'default')
    assert.equal(messageAgentTarget({ target: '@Juniper' }), 'juniper')
    assert.equal(messageAgentTarget({ target: 'peer/researcher' }), null)
    assert.equal(messageAgentTarget({ target: 'scout@cloud' }), null)
    assert.equal(messageAgentTarget(undefined), null)
  })
})

describe('a turn that is running now', () => {
  let n = 100
  const row = (role: string, content: string): StoredMessage => ({ id: ++n, role, content, timestamp: 100 }) as StoredMessage

  it('is between bots when another bot’s message started it, stored yet or not', () => {
    const dm = 'Message from 🤖 Orion (@hermes): ping'
    assert.equal(turnIsChatter([row('user', 'hi'), row('assistant', 'hello')], dm), true)
    assert.equal(turnIsChatter([row('user', 'hi'), row('assistant', 'hello'), row('user', dm)], dm), true)
    assert.equal(turnIsChatter([row('user', 'hi'), row('assistant', 'hello'), row('user', dm)], undefined), true)
  })

  it('is yours when you started it', () => {
    assert.equal(turnIsChatter([row('user', 'hi')], 'hi'), false)
    assert.equal(turnIsChatter([row('user', 'hi'), row('assistant', 'hello')], 'do the thing'), false)
    assert.equal(turnIsChatter([], undefined), false)
  })
})
