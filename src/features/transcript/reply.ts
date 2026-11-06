/**
 * Replying to one message of a chat or room: the message you swiped is quoted, one line, above what you write. Hermes has no
 * reply of its own, so the quote travels in the text as markdown (`> …`, then a blank line), which a bot reads as quoted
 * text; the app draws it back as a quiet line in your bubble. Pure.
 */

/** How much of the message is quoted: enough to say which one, short enough to stay one line on a phone. */
const QUOTE_MAX = 140

/**
 * The message as one plain line: markdown marks, links' addresses, code fences and a quote of its own taken out, and @mentions
 * as bare names: in a room Hermes asks every member a message @mentions, quote or not, and a quote is context, not an ask.
 */
export function replySnippet(text: string): string {
  const plain = splitReply(text).body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/(^|[^A-Za-z0-9_])@(?=[A-Za-z0-9_])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return plain.length > QUOTE_MAX ? `${plain.slice(0, QUOTE_MAX - 1).trimEnd()}…` : plain
}

/** What is sent: the quoted line, a blank line, then your words. */
export function withReply(quoted: string, message: string): string {
  const snippet = replySnippet(quoted)

  return snippet ? `> ${snippet}\n\n${message}` : message
}

/** A message sent as a reply split back into its quote and your words; `quote` is empty when it is not a reply. */
export function splitReply(text: string): { quote: string; body: string } {
  const match = /^> ([^\n]+)\n\n([\s\S]+)$/.exec(text)

  return match ? { quote: (match[1] as string).trim(), body: match[2] as string } : { quote: '', body: text }
}
