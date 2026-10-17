/**
 * One row per bot for the Home list: its name, what it is doing, and how to word the preview.
 * Pure: combines the roster, attention and inbox data the stores already hold.
 */

import { botLastActive, type Attention } from '../attention/derive.ts'
import type { InboxEntry } from '../inbox/derive.ts'
import type { BotSession } from '../sessions/store.ts'
import { displayName, type BotMeta } from '../../lib/hermes/identity.ts'
import type { FaceMood } from '../../lib/hermes/face.ts'
import type { DelegationStatusRow, ProfileRow } from '../../lib/hermes/protocol.ts'
import { runningJobs } from '../transcript/jobs.ts'
import { ageLabel, isPinned, previewOf, sortRoster, stripPreviewMarkdown } from './derive.ts'
import { visibleState, type VisibleActivity } from './visible.ts'

export interface BotView {
  profile: string
  name: string
  meta: BotMeta | undefined
  row: ProfileRow
  attention: Attention
  /** The one line under the name. */
  preview: string
  /** The preview reads as something to act on, so it is drawn at full strength. */
  urgent: boolean
  /** "now", "3m", "2h". */
  age: string
  /** When that was (epoch seconds): what Home sorts by, so the list reads in the order of its ages. */
  lastActive: number
  mood: FaceMood
  pinned: boolean
  /** How many things are waiting on you for this bot. */
  waiting: number
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** What a bot that needs you says it needs. Commands are shown, never logged. */
export function entryPreview(entry: InboxEntry): string {
  switch (entry.kind) {
    case 'approval':
      return entry.command ? `Wants to run ${oneLine(entry.command, 80)}` : (entry.summary || 'Wants to run a command')
    case 'sudo':
      return 'Needs your sudo password'
    case 'waiting':
      return 'Waiting for your answer'
    default:
      return oneLine(entry.summary, 100)
  }
}

export interface BuildInput {
  roster: ProfileRow[]
  attention: Record<string, Attention>
  inbox: Map<string, InboxEntry[]>
  sessions: Record<string, BotSession>
  /** Seconds. */
  now: number
  includeHidden?: boolean
  /** What each chat shows you last, by profile (see visible.ts). Falls back to the server's preview until read. */
  visible?: Record<string, VisibleActivity | undefined>
  /** Every helper running on the server (`delegation.status`). */
  background?: readonly DelegationStatusRow[]
}

/**
 * What a bot's helpers are still working on after its turn, for its row: the open chat's own helpers first, else the server's
 * list matched by the chat that sent them off (`owner_agent_session_id`, a stored session id). Null when none runs.
 */
export function backgroundGoal(row: ProfileRow, session: BotSession | undefined, background: readonly DelegationStatusRow[] = []): string | null {
  const own = runningJobs(session?.transcript.jobs).find(job => job.kind === 'helpers')

  if (own) {
    return own.label || 'Helpers working'
  }

  const chats = new Set([row.canonical_session?.id, row.canonical_session?.resolved_id, session?.storedId, session?.liveId].filter(Boolean))
  const task = background.find(entry => !entry.parent_id && entry.owner_agent_session_id && chats.has(entry.owner_agent_session_id) && (!entry.status || entry.status === 'running' || entry.status === 'queued'))

  return task ? task.goal || 'Helpers working' : null
}

export function buildBotViews(input: BuildInput): BotView[] {
  return sortRoster(input.roster, { includeHidden: input.includeHidden }).map(row => {
    const meta = row.ui_meta?.['hermes-bots']
    const attention = input.attention[row.name] ?? { state: 'idle' as const, unread: false }
    const entries = input.inbox.get(row.name) ?? []
    const session = input.sessions[row.name]
    // Without a lookup (nothing passed) the server's preview is all there is.
    const known = input.visible ? visibleState(input.visible[row.name], row.canonical_session) : ({ kind: 'server' } as const)
    const seen = known.kind === 'known' ? known.visible : undefined
    const last = known.kind === 'pending' ? { text: '', fromBot: null } : seen ? { text: stripPreviewMarkdown(seen.text), fromBot: null } : previewOf(row)

    let preview: string
    let urgent = false

    if (attention.state === 'needsYou' && entries[0]) {
      preview = entryPreview(entries[0])
      urgent = true
    } else if (attention.state === 'needsYou') {
      preview = 'Waiting for your answer'
      urgent = true
    } else if (attention.state === 'working') {
      preview = session?.transcript.wake ? 'Reading the result…' : session?.transcript.statusLine || 'Working…'
    } else {
      // The bot is idle, but work it handed off is still going: say so, calmly (no dot, not "Working…").
      const goal = backgroundGoal(row, session, input.background)

      preview = goal ? `Background · ${goal}` : last.fromBot ? `${last.fromBot}: ${last.text}` : last.text
      urgent = attention.unread
    }

    return {
      profile: row.name,
      name: displayName(row, meta),
      meta,
      row,
      attention,
      preview,
      urgent,
      age: attention.state === 'working' ? 'now' : known.kind === 'pending' ? '' : ageLabel(seen ? seen.ts : botLastActive(row), input.now),
      lastActive: attention.state === 'working' ? input.now : seen ? seen.ts : botLastActive(row),
      mood: attention.state === 'working' ? 'work' : 'idle',
      pinned: isPinned(row),
      waiting: entries.length,
    }
  })
}

/** "Forge, Courier, Scout": who needs you, for the Home row. */
export function needsYouNames(views: BotView[], max = 3): string {
  const names = views.filter(view => view.attention.state === 'needsYou').map(view => view.name)

  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ')
}
