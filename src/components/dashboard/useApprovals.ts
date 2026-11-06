import { useEffect, useState } from 'react'

import { approvalState, draftDigest, type ApprovalState } from '@/features/dashboard/digest'
import { sha256Hex } from '@/lib/auth-native'
import type { RecordDetail } from '@/lib/hermes/dashboard'

export interface Approvals {
  /** Where each approval draft stands, by draft key, once its digest is worked out on the phone. */
  states: Record<string, ApprovalState>
  /** The digest the screen drew, by draft key: what an approval sends. */
  drawn: Record<string, string | null>
  /** Drafts that changed under an approval you tried to send: the digest you saw and the one now. */
  changed: Record<string, { was: string; now: string }>
  markChanged: (draft: string, was: string, now: string) => void
  /** You looked at the new version: it is ready to approve again. */
  reviewed: (draft: string) => void
}

/**
 * The approvals on a record (hermes-dashboard 0.6+): for each draft you approve, the digest of exactly what the screen draws,
 * worked out on the phone, and where its approval stands against the server's. Approving is only offered while the two agree.
 */
export function useApprovals(detail: RecordDetail | undefined): Approvals {
  const [computed, setComputed] = useState<{ signature: string; digests: Record<string, string | null> }>({ signature: '', digests: {} })
  const [changed, setChanged] = useState<Record<string, { was: string; now: string }>>({})
  const keys = Object.keys(detail?.approvals ?? {})
  const signature = detail ? `${detail.record.id}:${detail.record.updated_at}:${keys.map(key => detail.approvals?.[key]?.digest).join(',')}` : ''

  useEffect(() => {
    let live = true

    if (detail && keys.length) {
      void Promise.all(keys.map(async key => [key, await draftDigest(detail, key, sha256Hex)] as const)).then(pairs => {
        if (live) {
          setComputed({ signature, digests: Object.fromEntries(pairs) })
        }
      })
    }

    return () => {
      live = false
    }
    // The signature stands for the record's content and the server's digests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Only digests worked out for the record as it is now count: a stale one never shows as a mismatch.
  const drawn = computed.signature === signature ? computed.digests : {}
  const states: Record<string, ApprovalState> = {}

  for (const key of keys) {
    const server = detail?.approvals?.[key]

    if (server && key in drawn) {
      states[key] = approvalState(server, drawn[key] ?? null)
    }
  }

  return {
    states,
    drawn,
    changed,
    markChanged: (draft, was, now) => setChanged(current => ({ ...current, [draft]: { was, now } })),
    reviewed: draft =>
      setChanged(current => {
        const next = { ...current }
        delete next[draft]

        return next
      }),
  }
}

/** An approval that is done with: approved and on its way, or sent. Its button has nothing left to do. */
export function settled(approvals: Approvals, draft: string | null): boolean {
  const kind = draft ? approvals.states[draft]?.kind : undefined

  return kind === 'approved' || kind === 'sent' || kind === 'sentOther'
}

/** The approval draft a button sends, when it has one: its key. */
export function approvalDraftOf(detail: RecordDetail, actionId: string): string | null {
  const draft = detail.collection.actions?.find(action => action.id === actionId)?.draft

  return draft && detail.approvals?.[draft] ? draft : null
}
