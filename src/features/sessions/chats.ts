/**
 * What the chat history list shows for one bot: its main chat (the Bot Chat Hermes keeps forever), then the other
 * chats it has had, newest first. Pure: the store fetches the rows, this decides what is listed and how.
 */

import { dashboardButton } from '../transcript/injected.ts'
import type { ChatSummary } from './store.ts'

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
  /** The chat that is open now. */
  current: boolean
}

export interface ChatListInput {
  listed: ChatSummary[]
  /** The bot's Bot Chat as the roster describes it. */
  main: { id: string | null; resolvedId?: string | null; preview?: string; startedAt?: number; messageCount?: number }
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

export function buildChatEntries({ listed, main, openId, elsewhere }: ChatListInput): ChatEntry[] {
  const mainIds = new Set([main.id, main.resolvedId].filter((id): id is string => !!id))

  const others = listed
    // Routines have their own place (and resuming one would disturb it); sub-agents are never listed by the server.
    .filter(chat => chat.source !== 'cron' && !mainIds.has(chat.id))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map<ChatEntry>(chat => ({
      id: chat.id,
      title: chat.title.trim() || firstLine(chat.preview) || 'Untitled chat',
      preview: chat.title.trim() ? firstLine(chat.preview) : '',
      startedAt: chat.startedAt,
      messageCount: chat.messageCount,
      main: false,
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
      current: !elsewhere,
    },
    ...others,
  ]

  // A chat started a moment ago has no stored row until its first message, so the server does not list it yet.
  if (elsewhere && openId && !others.some(entry => entry.id === openId)) {
    entries.splice(1, 0, { id: openId, title: 'New side chat', preview: '', startedAt: 0, messageCount: 0, main: false, current: true })
  }

  return entries
}
