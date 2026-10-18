/**
 * What the chat history list shows for one bot: its main chat (the Bot Chat Hermes keeps forever), its inbox when it has
 * one, then the other chats it has had, newest first. Pure: the store fetches the rows, this decides what is listed and how.
 */

import { dashboardButton } from '../transcript/injected.ts'
import type { ChatSummary } from './store.ts'

/**
 * The title of a bot's inbox: the chat where messages from other bots run, so they never take over its main chat
 * (hermes-bot-fixes 0.5). The app shows it as "Between bots", to read only: writing in it would hold it open on the
 * server, and the next bot's message into it would be turned away as busy.
 */
export const INBOX_TITLE = 'Bot Inbox'

/** The inbox's title, also as Hermes renames a chat it continues after compressing it ("Bot Inbox #2"). */
export function isInboxTitle(title: string): boolean {
  const trimmed = title.trim()

  return trimmed === INBOX_TITLE || (trimmed.startsWith(`${INBOX_TITLE} #`) && /^\d+$/.test(trimmed.slice(INBOX_TITLE.length + 2)))
}

export interface ChatEntry {
  /** The stored id; for the main chat, its stored id when the roster knows it. */
  id: string
  title: string
  preview: string
  /** Epoch seconds; 0 when unknown. */
  startedAt: number
  messageCount: number
  /** The bot's Bot Chat. It is always listed first and cannot be deleted. */
  main: boolean
  /** The bot's inbox: listed after the main chat, opened to read only, never deleted from here. */
  inbox: boolean
  /** The chat that is open now. */
  current: boolean
}

export interface ChatListInput {
  listed: ChatSummary[]
  /** The bot's Bot Chat as the roster describes it. */
  main: { id: string | null; resolvedId?: string | null; preview?: string; startedAt?: number; messageCount?: number }
  /** The bot's inbox, found by its title, or null when it has none. */
  inbox?: ChatSummary | null
  /** The chat that is open now (stored id), or null when none is. */
  openId: string | null
  /** The bot shows a chat other than its main one. */
  elsewhere: boolean
}

/** The first line of a preview, without markdown marks, for use as a title when a chat has none yet. */
function firstLine(text: string): string {
  const button = dashboardButton(text)

  // A chat a dashboard button started: "Send reply · Late delivery, Order 4", not the instructions written for the bot.
  if (button) {
    return `${button.label} · ${button.title}`
  }

  return (text.split('\n').find(line => line.trim()) ?? '').replace(/[`*]/g, '').replace(/^[#>\s]+/, '').trim()
}

export function buildChatEntries({ listed, main, inbox, openId, elsewhere }: ChatListInput): ChatEntry[] {
  const mainIds = new Set([main.id, main.resolvedId].filter((id): id is string => !!id))

  const others = listed
    // Routines have their own place (and resuming one would disturb it); sub-agents are never listed by the server. The
    // inbox has its own row, and is never a side chat, also before it has been found by its title.
    .filter(chat => chat.source !== 'cron' && !mainIds.has(chat.id) && chat.id !== inbox?.id && !isInboxTitle(chat.title))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map<ChatEntry>(chat => ({
      id: chat.id,
      title: chat.title.trim() || firstLine(chat.preview) || 'Untitled chat',
      preview: chat.title.trim() ? firstLine(chat.preview) : '',
      startedAt: chat.startedAt,
      messageCount: chat.messageCount,
      main: false,
      inbox: false,
      current: elsewhere && chat.id === openId,
    }))

  const entries: ChatEntry[] = [
    {
      id: main.id ?? 'main',
      title: 'Main chat',
      preview: firstLine(main.preview ?? ''),
      startedAt: main.startedAt ?? 0,
      messageCount: main.messageCount ?? 0,
      main: true,
      inbox: false,
      current: !elsewhere,
    },
    ...(inbox
      ? [{ id: inbox.id, title: 'Between bots', preview: firstLine(inbox.preview), startedAt: inbox.startedAt, messageCount: inbox.messageCount, main: false, inbox: true, current: false }]
      : []),
    ...others,
  ]

  // A chat started a moment ago has no stored row until its first message, so the server does not list it yet.
  if (elsewhere && openId && !others.some(entry => entry.id === openId)) {
    entries.splice(inbox ? 2 : 1, 0, { id: openId, title: 'New side chat', preview: '', startedAt: 0, messageCount: 0, main: false, inbox: false, current: true })
  }

  return entries
}
