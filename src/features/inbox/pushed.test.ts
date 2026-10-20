import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isRoomChat, kanbanAbout, kanbanForChat, parseKanban, parseNeedsYou, promptOf, type KanbanApproval, type PushedRequest } from './pushed.ts'

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

const kanbanRow = { id: 'k1', profile: 'orion', chat: '20261020_101500_0dc184', task: { id: 't_1', title: 'Clear the build cache', board: 'default', created_by: 'orion' }, command: 'rm -r build', description: 'recursive delete', allow_session: true, allow_permanent: false, created_at: 9 }

describe('kanban workers’ approvals', () => {
  it('reads them from the list, with choices from the allow flags', () => {
    assert.deepEqual(parseKanban({ live: true, version: 1, requests: [], kanban: [kanbanRow, { id: '', profile: 'x' }, 'junk'] }), [
      { id: 'k1', profile: 'orion', chat: '20261020_101500_0dc184', task: { id: 't_1', title: 'Clear the build cache', board: 'default', createdBy: 'orion' }, command: 'rm -r build', description: 'recursive delete', choices: ['once', 'session', 'deny'], createdAt: 9 },
    ])
    assert.deepEqual(parseKanban({ live: true, version: 1, requests: [] }), [], 'none from an older plugin')
  })

  it('shows each in the chat the card came from, or the bot’s main chat', () => {
    const [own] = parseKanban({ kanban: [kanbanRow] }) as [KanbanApproval]
    const main = { ...own, id: 'k2', chat: '' }
    const list = [own, main, { ...own, id: 'k3', profile: 'juniper' }]

    assert.deepEqual(kanbanForChat(list, 'orion', ['20261020_101500_0dc184'], false).map(a => a.id), ['k1'])
    assert.deepEqual(kanbanForChat(list, 'orion', ['20261019_090000_aa11bb', 'canon'], true).map(a => a.id), ['k2'])
    assert.deepEqual(kanbanForChat(list, 'orion', ['20261019_090000_aa11bb'], false), [], 'a side chat shows neither')
  })

  it('says which card it is for, and who asked when another bot did', () => {
    const [own] = parseKanban({ kanban: [kanbanRow] }) as [KanbanApproval]
    const names: Record<string, string> = { juniper: 'Juniper', orion: 'Orion' }
    const nameOf = (profile: string) => names[profile] ?? null

    assert.equal(kanbanAbout(own, nameOf), 'For the task “Clear the build cache”.')
    assert.equal(kanbanAbout({ ...own, task: { ...own.task, createdBy: 'juniper' } }, nameOf), 'For the task “Clear the build cache”, which Juniper asked for.')
    assert.equal(kanbanAbout({ ...own, task: { ...own.task, createdBy: 'dashboard', title: '' } }, nameOf), 'For a kanban task.')
  })
})
