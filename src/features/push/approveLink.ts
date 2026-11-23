/**
 * Parses `hermesbot://approve?id=...&choice=...&profile=...&kind=...` parameters safely.
 */

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export type ApprovalKind = 'auto' | 'kanban' | 'session'

export interface ParsedApproveLink {
  id: string
  choice: ApprovalChoice
  kind: ApprovalKind
  profile?: string
}

const VALID_CHOICES = new Set<ApprovalChoice>(['once', 'session', 'always', 'deny'])
const VALID_KINDS = new Set<ApprovalKind>(['auto', 'kanban', 'session'])

export function parseApproveParams(params: {
  id?: string | string[]
  choice?: string | string[]
  kind?: string | string[]
  profile?: string | string[]
}): ParsedApproveLink | null {
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? ''

  const id = pick(params.id)
  const choice = pick(params.choice) as ApprovalChoice
  const rawKind = pick(params.kind) as ApprovalKind
  const profile = pick(params.profile)

  if (!id || !VALID_CHOICES.has(choice)) {
    return null
  }

  const kind: ApprovalKind = VALID_KINDS.has(rawKind) ? rawKind : 'auto'

  return {
    id,
    choice,
    kind,
    ...(profile ? { profile } : {}),
  }
}
