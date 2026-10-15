/**
 * Coalesces a fast event stream so the UI re-renders a few times per second instead of once per token.
 * Urgent events (anything that changes structure: a tool, a prompt, the end of a turn) flush the
 * whole backlog immediately, in order, so nothing is ever reordered. Pure: timers are injected.
 */

export interface QueueTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface EventQueue<E> {
  push(event: E): void
  /** Deliver whatever is waiting now. */
  flush(): void
  dispose(): void
}

export const realTimers: QueueTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createEventQueue<E>(
  deliver: (events: E[]) => void,
  isUrgent: (event: E) => boolean,
  options: { delayMs?: number; timers?: QueueTimers } = {},
): EventQueue<E> {
  const delayMs = options.delayMs ?? 80
  const timers = options.timers ?? realTimers
  let pending: E[] = []
  let handle: unknown = null

  function flush() {
    if (handle !== null) {
      timers.clear(handle)
      handle = null
    }

    if (pending.length) {
      const batch = pending
      pending = []
      deliver(batch)
    }
  }

  return {
    push(event) {
      pending.push(event)

      if (isUrgent(event)) {
        flush()
      } else if (handle === null) {
        handle = timers.set(flush, delayMs)
      }
    },
    flush,
    dispose() {
      if (handle !== null) {
        timers.clear(handle)
        handle = null
      }

      pending = []
    },
  }
}
