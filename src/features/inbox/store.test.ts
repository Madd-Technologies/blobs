import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ActiveSessionRow, ApprovalRequestPayload } from '../../lib/hermes/protocol.ts'
import { createInbox } from './store.ts'

function setup(options: { active?: ActiveSessionRow[]; approvals?: Record<string, ApprovalRequestPayload[]>; open?: string[]; fail?: string } = {}) {
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

      if (method === 'approval.pending') {
        return { approvals: state.approvals[params.session_id as string] ?? [] } as T
      }

      if (method === 'approval.respond') {
        return { resolved: 1 } as T
      }

      throw new Error(`unscripted ${method}`)
    },
  }
  const inbox = createInbox({ client, openLiveIds: () => new Set(options.open ?? []), now: () => 42 })

  return { inbox, calls, state }
}

const row = (id: string, status: ActiveSessionRow['status']): ActiveSessionRow => ({ id, session_key: `k-${id}`, status })
const approval = (id: string): ApprovalRequestPayload => ({ command: 'cmd', description: 'desc', request_id: id })

describe('inbox refresh', () => {
  it('asks approval.pending only for working sessions the app has not opened', async () => {
    const { inbox, calls } = setup({
      active: [row('a', 'working'), row('b', 'idle'), row('c', 'waiting'), row('d', 'working')],
      open: ['d'],
      approvals: { a: [approval('r1')] },
    })
    await inbox.refresh()
    assert.deepEqual(calls.filter(call => call.method === 'approval.pending').map(call => call.params.session_id), ['a'])
    assert.deepEqual(Object.keys(inbox.store.getState().polled), ['a'])
    assert.equal(inbox.store.getState().loadedAt, 42)
  })

  it('does not hold a refresh for the 30 s approval.pending can block', async () => {
    const { inbox, calls } = setup({ active: [row('a', 'working')] })
    await inbox.refresh()
    assert.equal(calls.find(call => call.method === 'approval.pending')?.timeoutMs, 8_000)
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
