import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { HistoryEntry, RecordDetail } from '../../lib/hermes/dashboard.ts'
import { bylineOf, editable, entriesOf, fileLine, filesOf, listOf, shownBlocks, threadOf, trayOf } from './layout.ts'

const TASK: RecordDetail['collection'] = {
  key: 'juniper/background-work',
  owner: 'juniper',
  id: 'background-work',
  title: 'Background work',
  fields: [
    { key: 'title', label: 'Task', type: 'text', readonly: true },
    { key: 'status', label: 'Status', type: 'status', stages: [{ name: 'Running', done: false }, { name: 'Blocked', done: false }, { name: 'Done', done: true }] },
    { key: 'why', label: 'What it asks', type: 'longtext', format: 'markdown', readonly: true },
    { key: 'choices', label: 'Choices', type: 'list', readonly: true },
    { key: 'latest', label: 'What it has done', type: 'longtext', format: 'markdown', readonly: true },
    { key: 'attempts', label: 'Attempts', type: 'entries', readonly: true },
    { key: 'asked_by', label: 'Asked by', type: 'text', readonly: true },
  ],
  layout: {
    blocks: [
      { block: 'header', meta: 'status', byline: 'asked_by' },
      { block: 'ask', field: 'why', choices: 'choices', answer: 'note' },
      { block: 'text', field: 'latest', label: 'What it has done' },
      { block: 'entries', field: 'attempts', label: 'Attempts' },
      { block: 'notes', history: 'notes' },
    ],
    tray: { composer: true, secondary: ['ask'] },
  },
}

const detail = (values: Record<string, unknown>, show: Partial<NonNullable<RecordDetail['show']>> = {}, collection = TASK): Pick<RecordDetail, 'record' | 'collection' | 'show'> => ({
  record: { id: 'r1', collection: collection.key, source_key: null, values: values as RecordDetail['record']['values'], person_fields: {}, created_by: 'juniper', created_at: 1, updated_at: 1, closed_at: null },
  collection,
  show: { title: 'title', subtitle: null, meta: 'status', body: null, needs_you: false, view: null, ...show },
})

describe('a laid-out record', () => {
  it('shows the question only while it is up, and blocks only with something in them', () => {
    const blocked = detail({ status: 'Blocked', why: 'Which reviews count?', choices: ['A', 'B'], attempts: [{ label: 'Run 1 · stopped to ask you' }] }, { ask: true })
    assert.deepEqual(shownBlocks(blocked).map(block => block.block), ['header', 'ask', 'entries', 'notes'])
    assert.deepEqual(shownBlocks(detail({ status: 'Running', latest: 'Found 214 reviews.' }, { ask: false })).map(block => block.block), ['header', 'text', 'notes'])
    assert.deepEqual(shownBlocks(detail({}, {}, { ...TASK, layout: null })), [])
  })

  it('keeps a thread, not the bot’s bookkeeping', () => {
    const entry = (field: string): HistoryEntry => ({ at: 1, by_kind: 'bot', by: 'juniper', field, old: null, new: 'x' })
    const history = ['_note', 'status', 'updated', '_approved', '_sent', '_action', 'latest'].map(entry)
    assert.deepEqual(threadOf(history, 'notes').map(item => item.field), ['_note', '_approved', '_sent', '_action'])
    assert.equal(threadOf(history, 'all').length, 7)
  })

  it('reads list, entries and files values safely', () => {
    assert.deepEqual(listOf(['A', '', 3 as unknown as string, 'B']), ['A', 'B'])
    assert.deepEqual(listOf('A' as never), [])
    assert.deepEqual(entriesOf([{ label: 'Run 1' }, { detail: 'x' } as never]), [{ label: 'Run 1' }])
    assert.deepEqual(filesOf([{ name: 'a.pdf', path: '/a.pdf' }, { name: 'nowhere' }]), [{ name: 'a.pdf', path: '/a.pdf' }])
  })

  it('names the bot that asked, only when it is one of yours', () => {
    const name = (profile: string) => ({ orion: 'Orion' })[profile] ?? null
    assert.equal(bylineOf('asked_by', { asked_by: 'orion' }, name), 'asked by Orion')
    assert.equal(bylineOf('asked_by', { asked_by: 'stranger' }, name), null)
    assert.equal(bylineOf(undefined, {}, name), null)
  })

  it('says what a file is and how big', () => {
    assert.equal(fileLine({ name: 'House rules.pdf', path: '/a', mime: 'application/pdf', size: 182_000 }), 'PDF · 182 KB')
    assert.equal(fileLine({ name: 'Parking map.png', path: '/b', size: 1_240_000 }), 'PNG · 1.2 MB')
  })

  it('offers to change only what is yours', () => {
    assert.deepEqual(TASK.fields.filter(editable).map(field => field.key), ['status'])
  })
})

describe('the tray', () => {
  it('is a composer that answers the question while it is up', () => {
    assert.deepEqual(trayOf(detail({}, { ask: true }), 'Juniper', null), { composer: { placeholder: 'Or answer in your own words' }, primary: null, secondary: [{ kind: 'ask' }] })
    assert.equal(trayOf(detail({}, { ask: false }), 'Juniper', null).composer?.placeholder, 'Add a note for Juniper')
  })

  it('takes its buttons from what the record offers now', () => {
    const emails = { ...TASK, layout: { blocks: [{ block: 'notes' as const, history: 'notes' as const }], tray: { primary: 'send', secondary: ['ask', 'offer', 'done'] } } }
    const offered = detail({}, { actions: [{ id: 'send', label: 'Approve and send' }] }, emails)
    assert.deepEqual(trayOf(offered, 'Concierge', null), { composer: null, primary: { kind: 'action', id: 'send', label: 'Approve and send' }, secondary: [{ kind: 'ask' }, { kind: 'done', closed: false }] })
    const running = detail({}, { actions: [{ id: 'send', label: 'Approve and send' }], running: { action: 'send', label: 'Approve and send', session: null, at: 1 } }, emails)
    assert.equal(trayOf(running, 'Concierge', null).primary, null, 'none while a job is under way')
    const next = { ...emails, layout: { ...emails.layout, tray: { primary: 'next_stage' } } }
    assert.deepEqual(trayOf(detail({}, {}, next), 'Concierge', 'Done').primary, { kind: 'next', stage: 'Done' })
  })
})
