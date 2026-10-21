import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import type { DraftApproval, RecordDetail } from '../../lib/hermes/dashboard.ts'
import { approvalState, canonicalJson, coveredKeys, digestDocument, draftDigest, shortDigest } from './digest.ts'

const sha256Hex = async (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

const detail = (values: Record<string, unknown>): Pick<RecordDetail, 'record' | 'collection'> => ({
  record: { id: 'abc123def456', collection: 'concierge/guest-emails', source_key: null, values: values as RecordDetail['record']['values'], person_fields: {}, created_by: 'concierge', created_at: 1, updated_at: 1, closed_at: null },
  collection: {
    key: 'concierge/guest-emails',
    owner: 'concierge',
    id: 'guest-emails',
    title: 'Guest emails',
    fields: [
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'subject', label: 'Subject', type: 'text' },
      { key: 'cc', label: 'Cc', type: 'text' },
      { key: 'files', label: 'Attachments', type: 'files' },
      { key: 'reply', label: 'Reply', type: 'draft', format: 'html', to: 'email', approve: true, attachments: 'files', covers: ['subject', 'cc'] },
    ],
  },
})

const VALUES = {
  email: 'dana@example.com',
  subject: 'Re: Checkout',
  reply: '<p>Hi Dana, “1 PM” works.</p>\n\t<b>é</b>',
  files: [{ name: 'House rules.pdf', path: '/home/orion/rules.pdf', mime: 'application/pdf', size: 182000, sha256: 'a'.repeat(64) }],
}

describe('the approval digest', () => {
  it('is byte for byte the plugin’s (approvals.digest_of, computed in Python)', async () => {
    assert.equal(await draftDigest(detail(VALUES), 'reply', sha256Hex), '4f474d4071f28568b6f6838b96ba1efa444baff260b225ffbb71d26490996c77')
  })

  it('covers the draft, who it is to, the covered fields and the attachments', async () => {
    const base = await draftDigest(detail(VALUES), 'reply', sha256Hex)

    for (const change of [{ subject: 'Re: Other' }, { reply: `${VALUES.reply} ` }, { email: 'sam@example.com' }, { cc: 'alex@example.com' }, { files: [{ ...VALUES.files[0], sha256: 'b'.repeat(64) }] }]) {
      assert.notEqual(await draftDigest(detail({ ...VALUES, ...change }), 'reply', sha256Hex), base, JSON.stringify(change))
    }

    assert.deepEqual(coveredKeys(detail(VALUES).collection.fields[4]!), ['cc', 'email', 'subject'])
    assert.equal(digestDocument(detail(VALUES), 'subject'), null, 'not a draft')
  })

  it('sorts keys at every level, like Python', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: null, c: 'x\n"y"' }], é: true }), '{"a":[{"c":"x\\n\\"y\\"","d":null}],"b":1,"é":true}')
  })

  it('reads short on the card', () => {
    assert.equal(shortDigest('3f9a1c2e' + '0'.repeat(52) + '7b41'), '3f9a 1c2e … 7b41')
  })
})

describe('where an approval stands', () => {
  const server = (patch: Partial<DraftApproval> = {}): DraftApproval => ({ digest: 'd1', covers: [], ...patch })
  const approved = (digest: string, outcome?: NonNullable<DraftApproval['approved']>['outcome']): DraftApproval['approved'] => ({ digest, at: 10, action: 'send', draft: 'reply', ...(outcome ? { outcome } : {}) })

  it('waits for you only when what you see is what the server holds', () => {
    assert.deepEqual(approvalState(server(), 'd1'), { kind: 'waiting', digest: 'd1' })
    assert.deepEqual(approvalState(server(), 'other'), { kind: 'mismatch' })
    assert.deepEqual(approvalState(server(), null), { kind: 'mismatch' })
  })

  it('follows it through to what went out', () => {
    assert.deepEqual(approvalState(server({ approved: approved('d1') }), 'd1'), { kind: 'approved', digest: 'd1', at: 10 })
    assert.deepEqual(approvalState(server({ approved: approved('d1', { outcome: 'sent', digest: 'd1', at: 20, detail: null }) }), 'd1'), { kind: 'sent', digest: 'd1', at: 20 })
    assert.deepEqual(approvalState(server({ approved: approved('d1', { outcome: 'sent', digest: 'zz', at: 20, detail: null }) }), 'd1'), { kind: 'sentOther', approved: 'd1', sent: 'zz', at: 20 })
    assert.deepEqual(approvalState(server({ approved: approved('d1', { outcome: 'refused', digest: 'zz', at: 20, detail: 'The subject changed' }) }), 'd1'), { kind: 'refused', digest: 'd1', at: 20, detail: 'The subject changed' })
  })

  it('asks again when the draft changed after you approved it', () => {
    assert.deepEqual(approvalState(server({ digest: 'd2', approved: approved('d1') }), 'd2'), { kind: 'stale', approved: 'd1', digest: 'd2' })
    assert.deepEqual(approvalState(server({ digest: 'd2', approved: approved('d1', { outcome: 'refused', digest: null, at: 20, detail: null }) }), 'd2'), { kind: 'waiting', digest: 'd2' })
  })
})
