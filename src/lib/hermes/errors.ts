/** Human-readable error formatting for Hermes gateway RPCs and network errors. Pure: no React Native. */

import { JsonRpcGatewayError } from './gateway-client.ts'
import { RpcCode } from './protocol.ts'

const OWNER_REFUSALS: Record<string, string> = {
  SESSION_OWNER_BUSY: 'Hermes is busy in this chat right now. Your message wasn’t sent; try again in a moment.',
  SESSION_OWNER_UNCONFIRMED: 'Hermes couldn’t confirm your message was queued. Check the chat before sending it again.',
  SESSION_NOT_OWNED: 'Hermes has unfinished work in this chat from before a restart, so it won’t take new messages here until that’s cleared on the server (`hermes sessions discard`).',
}

export function describeError(error: unknown): string {
  if (error instanceof JsonRpcGatewayError) {
    const reason = (error.data as { reason?: unknown } | undefined)?.reason

    if (error.code === RpcCode.Refused && typeof reason === 'string' && OWNER_REFUSALS[reason]) {
      return OWNER_REFUSALS[reason]
    }

    if (error.code === RpcCode.Refused) {
      return 'This chat is open on another device. Close it there, or try again.'
    }

    if (error.code === RpcCode.TooLarge) {
      return 'This chat is too large to open.'
    }

    return error.message || 'The server returned an error.'
  }

  if (error instanceof Error) {
    return error.message === 'gateway not connected' ? 'Not connected to the server.' : error.message
  }

  return String(error)
}
