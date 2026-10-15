/**
 * The pure side of the Bot Screen viewer: the websocket address, and what to do when the connection ends.
 * The server closes the display socket with specific codes (Hermes `hermes_cli/web_routers/display.py`):
 *   4000  control taken: another viewer took over, so this one drops back to watching
 *   4001  the screen is gone (stopped, or its socket vanished)
 *   4401  the ticket was missing, spent or expired: ask for a new one
 *   4403  the server's host/origin policy refused the connection
 *   1003  protocol error (the server only speaks binary RFB)
 * Anything else (1006, no code) is a dropped link.
 */

/** `ws(s)://host:port/api/display/ws?display_ticket=…`. The ticket is a secret: never log this. */
export function displayWsUrl(baseUrl: string, path: string, ticket: string): string {
  const origin = baseUrl.replace(/^http/i, 'ws').replace(/\/+$/, '')
  const route = path.startsWith('/') ? path : `/${path}`

  return `${origin}${route}?display_ticket=${encodeURIComponent(ticket)}`
}

export type ViewerEvent =
  | { type: 'ready' }
  | { type: 'connected' }
  | { type: 'desktopname'; name?: string }
  | { type: 'securityfailure'; reason?: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected'; clean: boolean; code?: number; reason?: string }

/** Parses what the page posts. Anything else is not for us. */
export function parseViewerMessage(raw: string): ViewerEvent | null {
  try {
    const message = JSON.parse(raw) as { type?: unknown; [key: string]: unknown }

    switch (message.type) {
      case 'ready':
      case 'connected':
        return { type: message.type }

      case 'desktopname':
        return { type: 'desktopname', name: typeof message.name === 'string' ? message.name : undefined }

      case 'securityfailure':
        return { type: 'securityfailure', reason: typeof message.reason === 'string' ? message.reason : undefined }

      case 'error':
        return { type: 'error', message: typeof message.message === 'string' ? message.message : 'The viewer failed.' }

      case 'disconnected':
        return {
          type: 'disconnected',
          clean: message.clean === true,
          code: typeof message.code === 'number' ? message.code : undefined,
          reason: typeof message.reason === 'string' ? message.reason : undefined,
        }

      default:
        return null
    }
  } catch {
    return null
  }
}

export const CLOSE = { ControlTaken: 4000, ScreenGone: 4001, BadTicket: 4401, NotAllowed: 4403, Protocol: 1003 } as const

/** How long to wait before redialling a dropped link, by attempt. */
export const RECONNECT_DELAYS_MS = [400, 1200, 3000, 6000]

export type CloseDecision =
  /** Dial again (a fresh ticket), after `delayMs`. `viewOnly` says whether to come back watching. */
  | { kind: 'reconnect'; delayMs: number; viewOnly?: boolean; notice?: string }
  /** The screen is gone: re-read its status and show Start. */
  | { kind: 'gone'; message: string }
  | { kind: 'fail'; message: string }

export interface CloseContext {
  /** Consecutive failed attempts so far (reset when a connection is made). */
  attempts: number
}

export function decideAfterClose(close: { code?: number; clean?: boolean }, context: CloseContext): CloseDecision {
  switch (close.code) {
    case CLOSE.ControlTaken:
      // Not a failure: someone else drives now. Come back as a watcher at once.
      return { kind: 'reconnect', delayMs: 0, viewOnly: true, notice: 'Someone else took control.' }

    case CLOSE.ScreenGone:
      return { kind: 'gone', message: 'This screen stopped.' }

    case CLOSE.NotAllowed:
      return { kind: 'fail', message: 'The server refused the screen connection.' }

    case CLOSE.Protocol:
      return { kind: 'fail', message: 'The screen connection was refused as malformed.' }

    case CLOSE.BadTicket:
      // A spent or expired ticket is routine (a slow start, a retry): ask for another, but not forever.
      return context.attempts < 3 ? { kind: 'reconnect', delayMs: 0 } : { kind: 'fail', message: 'Could not get permission to open the screen. Try again.' }
  }

  const delay = RECONNECT_DELAYS_MS[context.attempts]

  return delay === undefined ? { kind: 'fail', message: 'Lost the connection to the screen.' } : { kind: 'reconnect', delayMs: delay }
}
