/**
 * Keeping the pictures a chat shows without fetching them again every time one scrolls into view, and without holding every
 * one in memory. Pure: no React Native imports.
 */

/** Together no more than this many characters of `data:` URL are kept (each is the picture as text, about a third larger than the file). */
export const MAX_CACHED_CHARS = 24 * 1024 * 1024

/** The keys to drop, least recently used first, so what is left fits in `maxChars`. The entry being shown now (`keep`) is never dropped. */
export function evictions(entries: Record<string, { size: number; used: number }>, maxChars: number, keep?: string): string[] {
  let total = Object.values(entries).reduce((sum, entry) => sum + entry.size, 0)
  const dropped: string[] = []

  for (const [key, entry] of Object.entries(entries).sort((a, b) => a[1].used - b[1].used)) {
    if (total <= maxChars) {
      break
    }

    if (key !== keep) {
      dropped.push(key)
      total -= entry.size
    }
  }

  return dropped
}

/** Runs tasks with at most `max` going at once, in the order they were asked for: a chat full of pictures must not open that many connections. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0
  const waiting: (() => void)[] = []

  const next = () => {
    running--
    waiting.shift()?.()
  }

  return async task => {
    if (running >= max) {
      await new Promise<void>(resolve => waiting.push(resolve))
    }

    running++

    try {
      return await task()
    } finally {
      next()
    }
  }
}

/** The height of a picture shown `width` wide, kept between a sliver and a screenful; a missing or broken size gives a 4:3 box. */
export function shownHeight(width: number, ratio: number | undefined, tallest = 360): number {
  const wide = ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3

  return Math.round(Math.min(Math.max(width / wide, 48), tallest))
}

/**
 * Who is asking for each picture right now: a row that is on screen asks when it appears and lets go when it leaves. A download that is
 * still waiting its turn when nobody wants it any more never starts. Counted, because the chat and the full-screen viewer can both want one.
 */
export function createWants() {
  const counts = new Map<string, number>()

  return {
    want: (key: string) => void counts.set(key, (counts.get(key) ?? 0) + 1),
    release: (key: string) => {
      const next = (counts.get(key) ?? 0) - 1

      if (next > 0) {
        counts.set(key, next)
      } else {
        counts.delete(key)
      }
    },
    isWanted: (key: string) => (counts.get(key) ?? 0) > 0,
  }
}

/** The rows on screen in each list, as `list|row` keys: this list's rows replaced by `keys`, the others left as they are. */
export function replaceRows(ids: Record<string, true>, list: string, keys: readonly string[]): Record<string, true> {
  const prefix = `${list}|`
  const next: Record<string, true> = {}

  for (const id of Object.keys(ids)) {
    if (!id.startsWith(prefix)) {
      next[id] = true
    }
  }

  for (const key of keys) {
    next[`${prefix}${key}`] = true
  }

  return next
}
