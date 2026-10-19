import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isRoomChat, parseNeedsYou, promptOf, type PushedRequest } from './pushed.ts'

const request = (partial: Partial<PushedRequest>): PushedRequest => ({ id: 'srq-1', method: 'approval', sessionId: 's', profile: 'orion', title: 'Bot Chat', createdAt: 1, params: {}, ...partial })

describe('parseNeedsYou', () => {
  it('reads the plugin’s list', () => {
    const body = { live: true, version: 2, requests: [{ id: 'srq-1', method: 'clarify', session_id: 's1', session_key: 'k', profile: 'juniper', title: 'Scratch', created_at: 7, params: { question: 'Which?' } }] }
    assert.deepEqual(parseNeedsYou(body), [{ id: 'srq-1', method: 'clarify', sessionId: 's1', profile: 'juniper', title: 'Scratch', createdAt: 7, params: { question: 'Which?' } }])
  })

  it('is null when the server cannot push it, so the app keeps its own check', () => {
    assert.equal(parseNeedsYou({ live: false, version: 0, requests: [] }), null)
    assert.equal(parseNeedsYou(null), null)
    assert.equal(parseNeedsYou({ detail: 'Not Found' }), null)
  })

  it('skips rows it cannot answer', () => {
    assert.deepEqual(parseNeedsYou({ live: true, requests: [null, { id: 'srq-2' }, { id: 'srq-3', method: 'sudo', session_id: 's' }] })?.map(row => row.id), ['srq-3'])
  })
})

describe('promptOf', () => {
  it('an approval keeps its own queue id and builds its choices from the allow flags', () => {
    assert.deepEqual(promptOf(request({ params: { request_id: 'r1', command: 'rm', description: 'delete', allow_permanent: false } })), {
      kind: 'approval',
      requestId: 'r1',
      summary: 'delete',
      command: 'rm',
      choices: ['once', 'session', 'deny'],
    })
  })

  it('a single question and a batch read the same way', () => {
    assert.deepEqual(promptOf(request({ method: 'clarify', params: { question: 'Which?', choices: ['A', 'B'] } })).questions, [{ question: 'Which?', choices: ['A', 'B'], multi_select: false }])
    const batch = promptOf(request({ method: 'clarify', params: { questions: [{ qid: 'q0', question: 'First?' }, { qid: 'q1', question: 'Second?' }] } }))
    assert.deepEqual([batch.kind, batch.requestId, batch.summary, batch.questions?.length], ['question', 'srq-1', 'First?', 2])
  })

  it('secret, sudo, and anything else', () => {
    assert.deepEqual(promptOf(request({ method: 'secret', params: { prompt: 'API key', env_var: 'K' } })), { kind: 'secret', requestId: 'srq-1', summary: 'API key', prompt: 'API key', envVar: 'K' })
    assert.equal(promptOf(request({ method: 'sudo' })).kind, 'sudo')
    assert.equal(promptOf(request({ method: 'vault.code' })).kind, 'waiting')
  })

  it('knows a group room member’s chat', () => {
    assert.equal(isRoomChat(request({ title: 'Group: r-1' })), true)
    assert.equal(isRoomChat(request({ title: 'Group chat ideas' })), false)
  })
})
