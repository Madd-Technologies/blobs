/**
 * Centralized server-reset registry so switching servers or disconnecting clears every server-scoped store in one place
 * without introducing circular imports into `connection.ts`.
 */
type ResetListener = (nextBaseUrl: string | null) => void

const listeners = new Set<ResetListener>()

export function registerServerReset(fn: ResetListener): () => void {
  listeners.add(fn)

  return () => {
    listeners.delete(fn)
  }
}

export function runServerResets(nextBaseUrl: string | null): void {
  for (const fn of [...listeners]) {
    try {
      fn(nextBaseUrl)
    } catch {
      // Never let one store's cleanup block the rest from resetting.
    }
  }
}
