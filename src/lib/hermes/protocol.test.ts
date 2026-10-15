import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import type { GatewayEvent } from './gateway-client.ts'
import { asHermesEvent, isPromptEvent, type HermesEvent } from './protocol.ts'

const dir = new URL('../../../docs/protocol-captures/', import.meta.url)

interface Line {
  kind: 'rpc' | 'event'
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  event?: GatewayEvent
}

function load(name: string): Line[] {
  return readFileSync(new URL(`${name}.jsonl`, dir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Line)
}

function events(name: string): HermesEvent[] {
  return load(name).flatMap(line => (line.kind === 'event' && line.event ? (asHermesEvent(line.event) ?? []) : []))
}

const TURNS = ['basic', 'approval', 'interrupt', 'clarify', 'failure']

/** Event types the server sends that the app deliberately does not model. */
const KNOWN_UNMODELLED = new Set<string>([])

describe('protocol captures', () => {
  it('has a capture for every turn the smoke test runs', () => {
    const files = readdirSync(dir).filter(name => name.endsWith('.jsonl'))
    for (const turn of TURNS) {
      assert.ok(files.includes(`${turn}.jsonl`), `${turn}.jsonl`)
    }
  })

  for (const turn of TURNS) {
    describe(turn, () => {
      it('contains only event types the app models', () => {
        const raw = load(turn).flatMap(line => (line.kind === 'event' && line.event ? [line.event] : []))
        const unknown = raw.filter(event => asHermesEvent(event) === null && !KNOWN_UNMODELLED.has(event.type)).map(event => event.type)
        assert.deepEqual([...new Set(unknown)], [])
      })

      it('has strictly increasing seq per session', () => {
        const last = new Map<string, number>()
        for (const event of events(turn)) {
          if (event.session_id === undefined || event.seq === undefined) {
            continue
          }
          const previous = last.get(event.session_id) ?? 0
          assert.ok(event.seq > previous, `seq ${event.seq} after ${previous} in ${turn}`)
          last.set(event.session_id, event.seq)
        }
      })

      it('starts with message.start and ends with message.complete then session.info', () => {
        const turnEvents = events(turn).filter(event => event.session_id !== undefined)
        assert.equal(turnEvents.find(event => event.type !== 'session.info')?.type, 'message.start')
        const types = turnEvents.map(event => event.type)
        const complete = types.lastIndexOf('message.complete')
        assert.ok(complete >= 0)
        assert.equal(types[complete + 1], 'session.info')
        assert.equal((turnEvents.at(-1) as HermesEvent).type, 'session.info')
      })
    })
  }

  it('approval: the request has what the card needs, and the deny leaves a blocked tool result', () => {
    const list = events('approval')
    const request = list.find(event => event.type === 'approval.request')
    assert.ok(request && request.type === 'approval.request' && isPromptEvent(request))
    assert.match(request.payload.request_id, /^[0-9a-f]{32}$/)
    assert.ok(request.payload.command.startsWith('rm -r /tmp/hermesbot-smoke-'))
    assert.deepEqual(request.payload.choices, ['once', 'session', 'always', 'deny'])
    assert.equal(request.payload.allow_session, true)

    const done = list.find(event => event.type === 'tool.complete')
    assert.ok(done && done.type === 'tool.complete')
    assert.equal(typeof done.payload.result === 'object' ? done.payload.result.status : null, 'blocked')

    const respond = load('approval').filter(line => line.kind === 'rpc' && line.method === 'approval.respond')
    assert.deepEqual(respond.map(line => (line.result as { resolved: number }).resolved), [1, 0])
  })

  it('approval: tool events run generating, start, then complete in order', () => {
    const order = events('approval')
      .filter(event => event.type.startsWith('tool.'))
      .map(event => event.type)
    assert.deepEqual(order, ['tool.generating', 'tool.start', 'tool.complete'])
  })

  it('clarify: the request is the batch form with server qids', () => {
    const request = events('clarify').find(event => event.type === 'clarify.request')
    assert.ok(request && request.type === 'clarify.request')
    assert.equal(request.payload.questions?.length, 1)
    assert.equal(request.payload.questions?.[0]?.qid, 'q0')
    assert.equal(request.payload.questions?.[0]?.choices?.length, 2)
  })

  it('interrupt: ends with an interrupted message.complete carrying the partial text', () => {
    const complete = events('interrupt').find(event => event.type === 'message.complete')
    assert.ok(complete && complete.type === 'message.complete')
    assert.equal(complete.payload.status, 'interrupted')
    assert.ok(complete.payload.text.length > 0)
  })

  it('failure: ends with status error and a readable message', () => {
    const complete = events('failure').find(event => event.type === 'message.complete')
    assert.ok(complete && complete.type === 'message.complete')
    assert.equal(complete.payload.status, 'error')
    assert.match(complete.payload.error ?? complete.payload.text, /HTTP 500/)
  })

  it('basic: deltas concatenate to the completed text', () => {
    const list = events('basic')
    const streamed = list.flatMap(event => (event.type === 'message.delta' ? [event.payload.text] : [])).join('')
    const complete = list.find(event => event.type === 'message.complete')
    assert.ok(complete && complete.type === 'message.complete')
    assert.equal(streamed, complete.payload.text)
  })

  it('messages.json: tool results pair to their calls by tool_call_id', () => {
    const page = JSON.parse(readFileSync(new URL('messages.json', dir), 'utf8')) as {
      messages: { role: string; tool_call_id?: string; tool_calls?: { id: string }[] }[]
    }
    const callIds = new Set(page.messages.flatMap(message => message.tool_calls?.map(call => call.id) ?? []))
    const results = page.messages.filter(message => message.role === 'tool')
    assert.ok(results.length > 0)
    for (const result of results) {
      assert.ok(result.tool_call_id && callIds.has(result.tool_call_id))
    }
  })
})
