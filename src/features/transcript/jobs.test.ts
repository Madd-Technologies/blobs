import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { HermesEvent } from '../../lib/hermes/protocol.ts'
import { describeJob, followsWorkOf, jobIdOfResult, jobOfResult, jobsLine, lastOutputLine, summarizeWork, withLists, withOutput, withSubagent } from './jobs.ts'
import { initialTranscript, reduceEvent } from './reduce.ts'
import type { Job, Step, TranscriptState } from './types.ts'

// Results and frames as Hermes 0.22.2 sent them (recorded against a demo server; ids shortened).
const BACKGROUND = { output: 'Background process started', session_id: 'proc_380c', pid: 63439, exit_code: 0, error: null, notify_on_complete: true }
const PROMOTED = { ...BACKGROUND, promoted_from_foreground: 'Your timeout of 3600s is over the 600s foreground cap: it runs in the background.' }
const YIELDED = { output: 'chromium  catalog    38/214\n', exit_code: null, error: null, status: 'yielded_to_background', session_id: 'proc_9a1b', pid: 1, notify_on_complete: true }
const DISPATCHED = {
  status: 'dispatched',
  mode: 'background',
  count: 3,
  delegation_id: 'deleg_1d34',
  goals: ['Run the cart suite', 'Run the checkout suite', 'Run the search suite'],
  subagent_ids: ['sa-0', 'sa-1', 'sa-2'],
}
const child = (index: number, extra: Record<string, unknown> = {}) => ({ goal: `Run suite ${index}`, task_count: 3, task_index: index, subagent_id: `sa-${index}`, delegation_id: 'deleg_1d34', depth: 0, ...extra })

const terminal = (command: string): Step => ({ toolId: 'call_1', name: 'terminal', context: command, state: 'done', args: { command } })

describe('jobIdOfResult', () => {
  it('reads a background command, a promoted one and one moved aside mid-run', () => {
    assert.equal(jobIdOfResult('terminal', BACKGROUND), 'proc_380c')
    assert.equal(jobIdOfResult('terminal', PROMOTED), 'proc_380c')
    assert.equal(jobIdOfResult('terminal', JSON.stringify(YIELDED)), 'proc_9a1b')
  })

  it('reads helpers sent off', () => {
    assert.equal(jobIdOfResult('delegate_task', DISPATCHED), 'deleg_1d34')
  })

  it('ignores an ordinary command, a failed start and other tools', () => {
    assert.equal(jobIdOfResult('terminal', { output: 'ok', exit_code: 0, error: null }), undefined)
    assert.equal(jobIdOfResult('terminal', { output: '', exit_code: -1, error: 'Failed to start background process: boom' }), undefined)
    assert.equal(jobIdOfResult('read_file', BACKGROUND), undefined)
    assert.equal(jobIdOfResult('terminal', 'Background process started'), undefined)
  })
})

describe('lastOutputLine', () => {
  it('is the newest line, with a redrawn progress bar read as its last frame', () => {
    assert.equal(lastOutputLine('chromium  catalog    38/214\nchromium  search     59/214\n\n'), 'chromium  search     59/214')
    assert.equal(lastOutputLine('[=>   ] 10%\r[===> ] 60%\r'), '[===> ] 60%')
    assert.equal(lastOutputLine('\u001b[32m✓ cart (44)\u001b[0m\n'), '✓ cart (44)')
    assert.equal(lastOutputLine('\n\n'), undefined)
  })
})

describe('a background command', () => {
  it('becomes a job named for its command, and follows its output', () => {
    const job = jobOfResult(terminal('npm run test:browsers'), BACKGROUND, 1_000) as Job
    assert.deepEqual(job, { id: 'proc_380c', kind: 'command', label: 'npm run test:browsers', state: 'running', startedAt: 1_000 })

    const later = withOutput(withOutput(job, 'chromium  catalog    38/214\n'), 'chromium  search     59/214\n')
    assert.equal(later.line, 'chromium  search     59/214')
    assert.equal(describeJob(later, 61_000).title, 'Running npm run test:browsers')
    assert.equal(describeJob(later, 61_000).detail, 'chromium  search     59/214')
    assert.equal(describeJob(later, 61_000).elapsedS, 60)
    assert.equal(describeJob(later, 61_000).fraction, undefined)
    assert.equal(jobsLine({ [later.id]: later }, 61_000 + 13 * 60_000), 'In the background · 14m')
    assert.equal(jobsLine({ [later.id]: later, other: { ...later, id: 'other' } }, 61_000), '2 in the background')
  })

  it('keeps what a command moved aside mid-run had printed', () => {
    assert.equal(jobOfResult(terminal('npm run test:browsers'), YIELDED, 0)?.line, 'chromium  catalog    38/214')
  })

  it('ends when process.list says it exited, with its exit code and how long it took', () => {
    const job = jobOfResult(terminal('sleep 25 && npm test'), BACKGROUND, 1_000) as Job
    const now = 40_000
    const row = { session_id: 'proc_380c', command: 'sleep 25 && npm test', uptime_seconds: 33, status: 'exited', exit_code: 0, exited_at: (now - 5_000) / 1000, output_tail: '  ✓ theme (13)\n\n  214 passing (2.4s)\n' }
    const done = withLists({ proc_380c: job }, [row], null, now).proc_380c as Job

    assert.equal(done.state, 'done')
    assert.equal(done.endedAt, 35_000)
    assert.equal(done.exitCode, 0)
    assert.equal(done.line, '214 passing (2.4s)')
    assert.equal(describeJob(done, now).title, 'Ran sleep 25 && npm test')
    assert.equal(describeJob(done, now).elapsedS, 34)

    const killed = withLists({ proc_380c: job }, [{ ...row, exit_code: -15 }], null, now).proc_380c
    assert.equal(killed?.state, 'failed')
  })

  it('a running command the list no longer has is over; one it lists from before the chat opened is picked up', () => {
    const job = jobOfResult(terminal('npm test'), BACKGROUND, 0) as Job
    assert.equal(withLists({ proc_380c: job }, [], null, 9_000).proc_380c?.state, 'done')

    const found = withLists(undefined, [{ session_id: 'proc_77', command: 'npm run build', uptime_seconds: 90, status: 'running', output_tail: 'step 3/7\n' }], null, 100_000).proc_77
    assert.deepEqual(found, { id: 'proc_77', kind: 'command', label: 'npm run build', state: 'running', startedAt: 10_000, output: 'step 3/7\n', line: 'step 3/7' })
  })
})

describe('helpers', () => {
  it('count finished of started, from the server, as the only fraction', () => {
    let job = withSubagent(undefined, 'subagent.start', child(0), 1_000)
    job = withSubagent(job, 'subagent.start', child(1), 1_000)
    job = withSubagent(job, 'subagent.start', child(2), 1_000)
    job = jobOfResult({ name: 'delegate_task', context: '3 tasks', args: {} }, DISPATCHED, 1_050, job) as Job

    assert.equal(job.state, 'running')
    assert.deepEqual(describeJob(job, 5_000).fraction, { done: 0, total: 3 })
    assert.equal(describeJob(job, 5_000).title, '3 helpers working')

    job = withSubagent(job, 'subagent.complete', child(0, { status: 'completed', duration_seconds: 18 }), 19_000) as Job
    assert.deepEqual(describeJob(job, 19_000).fraction, { done: 1, total: 3 })
    assert.equal(jobsLine({ [job.id]: job }, 19_000), 'Helpers · 1 of 3 done')

    // A progress frame that trails a child's completion does not bring it back.
    job = withSubagent(job, 'subagent.progress', child(0), 19_100) as Job
    assert.deepEqual(describeJob(job, 19_100).fraction, { done: 1, total: 3 })

    job = withSubagent(job, 'subagent.complete', child(1, { status: 'failed' }), 39_000) as Job
    job = withSubagent(job, 'subagent.complete', child(2, { status: 'completed' }), 59_000) as Job
    assert.equal(job.state, 'done')
    assert.equal(job.endedAt, 59_000)
    assert.equal(describeJob(job, 70_000).title, '3 helpers finished')
    assert.equal(jobsLine({ [job.id]: job }, 70_000), undefined)
  })

  it('one helper gets no bar', () => {
    const one = withSubagent(undefined, 'subagent.start', { ...child(0), task_count: 1 }, 0) as Job
    assert.equal(describeJob(one, 1_000).fraction, undefined)
    assert.equal(describeJob(one, 1_000).title, '1 helper working')
  })

  it('after a reopen, the live list says who is still working; the count returns with the next frame', () => {
    const listed = withLists(undefined, null, [{ subagent_id: 'sa-2', delegation_id: 'deleg_1d34', goal: 'Run suite 2', started_at: 1, status: 'running' }], 9_000)
    const job = listed.deleg_1d34 as Job
    assert.equal(describeJob(job, 9_000).fraction, undefined)
    assert.equal(describeJob(job, 9_000).title, '1 helper working')

    const counted = withSubagent(job, 'subagent.progress', child(2), 9_500) as Job
    assert.deepEqual(describeJob(counted, 9_500).fraction, { done: 2, total: 3 })
  })

  it('a helper the live list no longer has finished', () => {
    const job = jobOfResult({ name: 'delegate_task', context: '', args: {} }, DISPATCHED, 0) as Job
    const after = withLists({ [job.id]: job }, null, [{ subagent_id: 'sa-2', delegation_id: 'deleg_1d34' }], 30_000).deleg_1d34 as Job
    assert.deepEqual(describeJob(after, 30_000).fraction, { done: 2, total: 3 })
  })
})

describe('summarizeWork', () => {
  const started: Step = { ...terminal('npm run test:browsers'), startedAt: 1_000, durationS: 0.46, resultLine: 'Background process started', jobId: 'proc_380c' }
  const read: Step = { toolId: 'call_0', name: 'read_file', context: '/p/package.json', state: 'done', startedAt: 500, durationS: 0.1 }

  it('is exactly the old line without jobs', () => {
    assert.deepEqual(summarizeWork([read, started], undefined, 10_000), { kind: 'done', title: 'Ran 2 steps · <1s', stepCount: 2 })
  })

  it('a running job takes the line after its step returned', () => {
    const job: Job = { id: 'proc_380c', kind: 'command', label: 'npm run test:browsers', state: 'running', startedAt: 1_000, line: 'firefox   cart      147/214' }
    const summary = summarizeWork([read, started], { proc_380c: job }, 843_000)

    assert.equal(summary.kind, 'running')
    assert.equal(summary.title, 'Running npm run test:browsers')
    assert.equal(summary.elapsedS, 842)
    assert.equal(summary.job?.detail, 'firefox   cart      147/214')
    assert.equal(summary.current, started)
  })

  it('a step still running in the foreground keeps the line', () => {
    const job: Job = { id: 'proc_380c', kind: 'command', label: 'npm run test:browsers', state: 'running', startedAt: 1_000 }
    const busy: Step = { toolId: 'call_2', name: 'terminal', context: 'git status', state: 'running', startedAt: 5_000 }

    assert.equal(summarizeWork([started, busy], { proc_380c: job }, 6_000).title, 'Running git status')
  })

  it('once the job is over, the run folds with the time the job took', () => {
    const job: Job = { id: 'proc_380c', kind: 'command', label: 'npm run test:browsers', state: 'done', startedAt: 1_000, endedAt: 1_000 + 72 * 60_000, exitCode: 0 }

    assert.deepEqual(summarizeWork([read, started], { proc_380c: job }, 9e9), { kind: 'done', title: 'Ran 2 steps · 1h 12m', stepCount: 2 })
  })
})

describe('the reducer with and without live work', () => {
  const events: HermesEvent[] = [
    { type: 'message.start', payload: {} },
    { type: 'tool.start', payload: { tool_id: 'call_1', name: 'terminal', context: 'npm run test:browsers', args: { command: 'npm run test:browsers', timeout: 43200 } } },
    { type: 'tool.complete', payload: { tool_id: 'call_1', name: 'terminal', args: { command: 'npm run test:browsers', timeout: 43200 }, duration_s: 0.46, result: PROMOTED } },
    { type: 'message.complete', payload: { text: "It's running in the background.", status: 'complete' } },
    { type: 'agent.terminal.output', payload: { process_id: 'proc_380c', chunk: 'chromium  catalog    38/214\n' } },
    { type: 'status.update', payload: { kind: 'process', text: 'Background Process Failed (exit -15): npm run test:browsers' } },
    { type: 'subagent.start', payload: child(0) },
  ]
  const play = (state: TranscriptState) => events.reduce((next, event, index) => reduceEvent(next, event, 1_000 + index), state)

  it('an older server (no live work) reads exactly as before: no job, no new state', () => {
    const before = play(initialTranscript())
    const activity = before.items.find(item => item.kind === 'activity')

    assert.equal(before.jobs, undefined)
    assert.equal(activity?.kind === 'activity' && activity.steps[0]?.jobId, undefined)
    assert.equal(activity?.kind === 'activity' && activity.steps[0]?.resultLine, 'Background process started')
    assert.equal(before.statusLine, 'Background Process Failed (exit -15): npm run test:browsers')
  })

  it('a 0.22 server: the step points at its job, output and helpers are followed, process news stays off the header', () => {
    const after = play({ ...initialTranscript(), liveWork: true })
    const activity = after.items.find(item => item.kind === 'activity')

    assert.equal(activity?.kind === 'activity' && activity.steps[0]?.jobId, 'proc_380c')
    assert.equal(after.jobs?.proc_380c?.line, 'chromium  catalog    38/214')
    assert.equal(after.jobs?.proc_380c?.label, 'npm run test:browsers')
    assert.equal(after.jobs?.deleg_1d34?.kind, 'helpers')
    assert.equal(after.statusLine, null)
  })

  it('a 0.21.5 server: helpers are followed, a background command and its news read as before', () => {
    const after = play({ ...initialTranscript(), liveHelpers: true })
    const activity = after.items.find(item => item.kind === 'activity')

    assert.equal(activity?.kind === 'activity' && activity.steps[0]?.jobId, undefined)
    assert.equal(after.jobs?.proc_380c, undefined)
    assert.equal(after.jobs?.deleg_1d34?.kind, 'helpers')
    assert.equal(after.statusLine, 'Background Process Failed (exit -15): npm run test:browsers')
  })

  it('a 0.21.5 server: the delegate_task step points at its helpers', () => {
    const sent: HermesEvent[] = [
      { type: 'message.start', payload: {} },
      { type: 'tool.start', payload: { tool_id: 'call_3', name: 'delegate_task', context: '3 tasks', args: {} } },
      { type: 'tool.complete', payload: { tool_id: 'call_3', name: 'delegate_task', args: {}, duration_s: 0.2, result: DISPATCHED } },
    ]
    const after = sent.reduce<TranscriptState>((next, event) => reduceEvent(next, event, 1_000), { ...initialTranscript(), liveHelpers: true })
    const activity = after.items.find(item => item.kind === 'activity')

    assert.equal(activity?.kind === 'activity' && activity.steps[0]?.jobId, 'deleg_1d34')
    assert.equal(after.jobs?.deleg_1d34?.total, 3)
  })
})

describe('followsWorkOf', () => {
  it('follows everything with live work, only helpers with live helpers, nothing without either', () => {
    assert.equal(followsWorkOf('terminal', { liveWork: true }), true)
    assert.equal(followsWorkOf('delegate_task', { liveWork: true }), true)
    assert.equal(followsWorkOf('delegate_task', { liveHelpers: true }), true)
    assert.equal(followsWorkOf('terminal', { liveHelpers: true }), false)
    assert.equal(followsWorkOf('delegate_task', {}), false)
  })
})
