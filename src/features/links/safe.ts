/**
 * Which links the app opens outside itself. A link comes from a bot's reply, a dashboard value or a page a bot made, so a bot (or
 * something it read) chooses it. Only the kinds a person expects from a tap open: a web page, a mail, a call or a text. Any other
 * scheme is refused, above all this app's own (`hermesbot://`), whose routes answer approvals and questions: a tap on a link in a
 * reply must never stand in for a tap on Allow. Pure.
 */

const OPENABLE = /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d][\d\s().-]*|sms:[+\d][\d\s().-]*)$/i

/** The link, trimmed, when the app may open it outside itself; otherwise null. */
export function openableLink(href: string): string | null {
  const link = href.trim()

  return OPENABLE.test(link) ? link : null
}
