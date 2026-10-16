/**
 * The transcript model the chat renders. A pure description: no React, no React Native.
 *
 * One list of items in time order. A run of consecutive tool calls is a single `activity` item, so the
 * chat shows "Ran 4 steps" instead of four boxes. Prompts the agent puts to the user (approvals,
 * questions, secrets, sudo) are items too, so they sit in the conversation where they were asked.
 */

import type { AttachmentChip } from '../../lib/hermes/attachments.ts'
import type { ApprovalChoice, ClarifyQuestion, MessageStatus, Usage } from '../../lib/hermes/protocol.ts'

export type StepState = 'running' | 'done' | 'failed' | 'blocked'

export interface Step {
  toolId: string
  /** The tool's name as the server reports it (`terminal`, `read_file`, …). */
  name: string
  /** What it is acting on: the command, path or query. */
  context: string
  state: StepState
  args?: Record<string, unknown>
  /** Wall-clock ms when `tool.start` arrived (live steps only). */
  startedAt?: number
  durationS?: number
  /** Last non-empty line of output, shown quietly under a running step. */
  resultLine?: string
  /** Full output for the expanded view. May be long: render lazily. */
  output?: string
  /** The command's exit status, when the tool reported one. */
  exitCode?: number
  /** A picture this step made (an `image_generate` result): a path on the server or an https URL. Drawn under the step's line. */
  image?: string
  /** The bot tried to use the screen while a human held it (`computer_use` answered `human_has_control`). */
  humanHasControl?: boolean
  /** What an edit changed, as a unified diff (a `patch` result's `diff`, or the server's `inline_diff`). */
  diff?: string
  /** The file a step wrote or read, as an absolute path on the server, to open in the viewer. */
  file?: string
  /**
   * The step started work the server keeps running after it returned: a background command (`proc_…`) or a batch of
   * helpers (`deleg_…`). Its live state is the `Job` with this id, when the server reports it (Hermes 0.22+).
   */
  jobId?: string
}

/**
 * Work that outlives the step that started it (Hermes 0.22+): a command the server runs in the background, or helpers
 * (subagents) a bot sent off. Only what the server reports: output it relayed, children it said finished.
 */
export interface Job {
  /** The process id (`proc_…`) or the delegation id (`deleg_…`). */
  id: string
  kind: 'command' | 'helpers'
  /** The command, or what the helpers were asked to do. */
  label: string
  state: 'running' | 'done' | 'failed'
  /** Wall-clock ms it started (or when the app first saw it, less the uptime the server gave). */
  startedAt?: number
  /** Wall-clock ms it ended, once known. */
  endedAt?: number
  /** A command's newest line of output. */
  line?: string
  /** A command's output so far (its tail), for the expanded step. */
  output?: string
  exitCode?: number
  /** Helpers: how many the server said it started (`task_count`). */
  total?: number
  /** Helpers: each child's state, by subagent id. */
  children?: Record<string, 'running' | 'done' | 'failed'>
}

/** `pending` waits for the user, `answered` was handled (here or elsewhere), `expired` timed out. */
export type PromptState = 'pending' | 'answered' | 'expired'

type ItemBase =
  | { kind: 'user'; id: string; text: string; /** Not yet confirmed by the server. */ pending?: boolean; /** Wall-clock ms when it was sent. */ ts?: number; /** Files sent with it. */ attachments?: AttachmentChip[] }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean; status?: MessageStatus; /** Wall-clock ms when the reply began. */ ts?: number }
  | { kind: 'activity'; id: string; steps: Step[] }
  | {
      kind: 'approval'
      id: string
      requestId: string
      /** Sensitive: show it, never log or persist it. */
      command: string
      description: string
      choices: ApprovalChoice[]
      state: PromptState
      choice?: ApprovalChoice
    }
  | { kind: 'question'; id: string; requestId: string; questions: ClarifyQuestion[]; state: PromptState; answer?: string }
  | { kind: 'secret'; id: string; requestId: string; prompt: string; envVar: string; state: PromptState }
  | { kind: 'sudo'; id: string; requestId: string; state: PromptState }
  | { kind: 'error'; id: string; message: string }
  /** The turn was stopped before it produced a reply, so there is no bubble to caption. */
  | { kind: 'stopped'; id: string }
  | { kind: 'thinking'; id: string; text: string }
  /** Something the server did, stored as a user turn (a background process finished): one quiet line. */
  | { kind: 'note'; id: string; text: string; ts?: number }
  /** What a slash command printed (`/status`): shown in the chat, never stored by the server. */
  | { kind: 'output'; id: string; command: string; text: string; /** Names to lay out as a wrapping row under a title, ahead of `text` (so no name is split across lines). */ groups?: { title: string; names: string[] }[]; /** The command has not answered yet. */ pending?: boolean }
  /** Another bot's message to this one (`message_agent`), drawn from the sender. */
  | { kind: 'teammate'; id: string; handle: string; text: string; ts?: number }

/**
 * Everything the chat can show. `chatter` marks what happened between bots (another bot's message, the turn it started,
 * and a bot's wake-up for a message it sent for another bot): kept in the transcript, drawn only if the person asks.
 */
export type Item = ItemBase & { chatter?: true }

export type PromptItem = Extract<Item, { kind: 'approval' | 'question' | 'secret' | 'sudo' }>

/** What the bot is doing right now, for the header's quiet status line. */
export type Phase = 'idle' | 'thinking' | 'writing' | 'tool'

export interface TranscriptState {
  items: Item[]
  /** A turn is in flight. */
  running: boolean
  phase: Phase
  /** The latest `status.update` text ("Retrying in 2s…"); cleared when the turn ends. */
  statusLine: string | null
  title: string | null
  usage: Usage | null
  todos: unknown[] | null
  /** Status of the last finished turn. */
  lastTurn: MessageStatus | null
  /**
   * While a turn between bots is running, where it starts in `items`: from there on is chatter, even though the live
   * items carry no flag yet. Becomes flags (and null) when the turn ends or the person sends.
   */
  chatterFrom: number | null
  /**
   * While a routine's turn is running (the bot working on a routine's output), where its items start: everything from there
   * is the bot working, and when the turn ends its last reply (the summary for the person) is shown.
   */
  routineFrom?: number | null
  /**
   * The server reports work that outlives a step (Hermes 0.22+: background commands' output, helpers' progress). Off, those
   * events are ignored and every step reads as it always has.
   */
  liveWork?: boolean
  /** Background commands and helpers this chat's steps started, by id (only with `liveWork`). */
  jobs?: Record<string, Job>
  /** Counter for ids of items that have no server id. */
  nextId: number
}
