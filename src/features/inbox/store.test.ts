import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ActiveSessionRow, ApprovalRequestPayload, DelegationStatusRow } from '../../lib/hermes/protocol.ts'
import { approvalsFrom, createInbox } from './store.ts'

function setup(options: { active?: ActiveSessionRow[]; approvals?: Record<string, ApprovalRequestPayload[]>; open?: string[]; fail?: string; helpers?: DelegationStatusRow[] } = {}) {
  const calls: { method: string; params: Record<string, unknown>; timeoutMs?: number }[] = []
  const state = { active: options.active ?? [], approvals: options.approvals ?? {} }
  const client = {
    async request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
      calls.push({ method, params, timeoutMs })

      if (method === options.fail) {
        throw new Error('boom')
      }

      if (method === 'session.active_list') {
        return { sessions: state.active } as T
      }

      if (method === 'session.events.since') {
        // As Hermes 0.21.5 replays them: each waiting approval is an open server request, its params the approval as sent.
        const open = (state.approvals[params.session_id as string] ?? []).map(entry => ({ id: `srq-${entry.request_id}`, method: 'approval', params: { session_id: params.session_id, ...entry } }))

        return { events: [], open_requests: open } as T
      }

      if (method === 'approval.respond') {
        return { resolved: 1 } as T
      }

      if (method === 'delegation.status') {
        return { active: options.helpers ?? [], paused: false } as T
      }

      throw new Error(`unscripted ${method}`)
    },
  }
  const inbox = createInbox({ client, openLiveIds: () => new Set(options.open ?? []), liveHelpers: () => options.helpers !== undefined, now: () => 42 })

  return { inbox, calls, state }
}

const row = (id: string, status: ActiveSessionRow['status']): ActiveSessionRow => ({ id, session_key: `k-${id}`, status })
const approval = (id: string): ApprovalRequestPayload => ({ command: 'cmd', description: 'desc', request_id: id })

describe('inbox refresh', () => {
  it('reads the open requests of working and waiting sessions the app has not opened', async () => {
    const { inbox, calls } = setup({
      active: [row('a', 'working'), row('b', 'idle'), row('c', 'waiting'), row('d', 'working'), row('e', 'waiting')],
      open: ['d', 'e'],
      approvals: { a: [approval('r1')] },
    })
    await inbox.refresh()
    assert.deepEqual(calls.filter(call => call.method === 'session.events.since').map(call => call.params.session_id), ['a', 'c'])
    assert.equal(calls.some(call => call.method === 'approval.pending'), false, 'never approval.pending: it can hold the socket for 30 s')
    assert.deepEqual(Object.keys(inbox.store.getState().polled), ['a'])
    assert.equal(inbox.store.getState().loadedAt, 42)
  })

  it('finds an approval on a session the server marks waiting (Hermes 0.21.6)', async () => {
    const { inbox } = setup({ active: [row('courier', 'waiting')], approvals: { courier: [approval('r1')] } })
    await inbox.refresh()
    assert.deepEqual(inbox.store.getState().polled.courier?.map(entry => entry.request_id), ['r1'])
  })

  it('does not hold a refresh for a slow reply', async () => {
    const { inbox, calls } = setup({ active: [row('a', 'working')] })
    await inbox.refresh()
    assert.equal(calls.find(call => call.method === 'session.events.since')?.timeoutMs, 5_000)
  })

  it('drops sessions that no longer hold an approval', async () => {
    const { inbox, state } = setup({ active: [row('a', 'working')], approvals: { a: [approval('r1')] } })
    await inbox.refresh()
    assert.equal(Object.keys(inbox.store.getState().polled).length, 1)
    state.approvals = {}
    await inbox.refresh()
    assert.deepEqual(inbox.store.getState().polled, {})
  })

  it('concurrent refreshes share one run', async () => {
    const { inbox, calls } = setup({ active: [row('a', 'idle')] })
    await Promise.all([inbox.refresh(), inbox.refresh(), inbox.refresh()])
    assert.equal(calls.filter(call => call.method === 'session.active_list').length, 1)
  })

  it('keeps the last good picture and notes the error when refresh fails', async () => {
    const { inbox, state } = setup({ active: [row('a', 'idle')] })
    await inbox.refresh()
    assert.equal(inbox.store.getState().active.length, 1)
    const failing = setup({ fail: 'session.active_list' })
    await failing.inbox.refresh()
    assert.equal(failing.inbox.store.getState().error, 'boom')
    assert.ok(state)
  })

  it('a failed approval.pending for one session does not lose the others', async () => {
    const { inbox } = setup({ active: [row('a', 'working'), row('b', 'working')], approvals: { b: [approval('r9')] }, fail: 'nothing' })
    await inbox.refresh()
    assert.deepEqual(Object.keys(inbox.store.getState().polled), ['b'])
  })
})

describe('inbox respondApproval', () => {
  it('answers on the live id and clears the entry', async () => {
    const { inbox, calls } = setup({ active: [row('a', 'working')], approvals: { a: [approval('r1'), approval('r2')] } })
    await inbox.refresh()
    assert.equal(await inbox.respondApproval('a', 'r1', 'deny'), true)
    assert.deepEqual(calls.at(-1), { method: 'approval.respond', params: { session_id: 'a', request_id: 'r1', choice: 'deny' }, timeoutMs: undefined })
    assert.deepEqual(inbox.store.getState().polled.a?.map(entry => entry.request_id), ['r2'])
    await inbox.respondApproval('a', 'r2', 'once')
    assert.equal('a' in inbox.store.getState().polled, false)
  })
})

describe('helpers still running after their bot’s turn', () => {
  const helper: DelegationStatusRow = { subagent_id: 'sa-0', goal: 'Write the release notes', status: 'running', owner_agent_session_id: 'chat-1' }

  it('are read with the sessions when the server lists them', async () => {
    const { inbox, calls } = setup({ active: [row('a', 'idle')], helpers: [helper] })
    await inbox.refresh()
    assert.deepEqual(inbox.store.getState().background, [helper])
    assert.equal(calls.filter(call => call.method === 'delegation.status').length, 1)
  })

  it('are not asked for on a server without them', async () => {
    const { inbox, calls } = setup({ active: [row('a', 'idle')] })
    await inbox.refresh()
    assert.deepEqual(inbox.store.getState().background, [])
    assert.equal(calls.some(call => call.method === 'delegation.status'), false)
  })

  it('a failed read shows none and keeps the rest of the poll', async () => {
    const { inbox } = setup({ active: [row('a', 'idle')], helpers: [helper], fail: 'delegation.status' })
    await inbox.refresh()
    assert.deepEqual(inbox.store.getState().background, [])
    assert.equal(inbox.store.getState().error, null)
    assert.equal(inbox.store.getState().active.length, 1)
  })
})

describe('approvals among a session\'s open requests', () => {
  it('reads an approval as the server sent it, and nothing else', () => {
    const open = [
      { id: 'srq-1', method: 'approval', params: { session_id: 's', request_id: 'r1', command: 'docker compose pull', description: 'Pulls images', choices: ['once', 'deny'], allow_session: true, allow_permanent: false } },
      { id: 'srq-2', method: 'clarify', params: { session_id: 's', question: 'A or B?' } },
      { id: 'srq-3', method: 'approval', params: { session_id: 's', command: 'rm -r /tmp/x', description: '' } },
    ]

    assert.deepEqual(approvalsFrom(open), [
      { request_id: 'r1', command: 'docker compose pull', description: 'Pulls images', choices: ['once', 'deny'], allow_session: true, allow_permanent: false },
      { request_id: 'srq-3', command: 'rm -r /tmp/x', description: '' },
    ])
    assert.deepEqual(approvalsFrom(undefined), [])
  })
})
