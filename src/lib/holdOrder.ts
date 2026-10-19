/**
 * A list shown in the order it had when `held` was taken, so a row never moves under a finger: rows still there keep
 * their places, rows that are new go after them in their own order, and rows that are gone are left out. With no
 * `held`, the list as it is. Pure.
 */
export function holdOrder<T>(items: readonly T[], key: (item: T) => string, held: readonly string[] | null): T[] {
  if (!held) {
    return [...items]
  }

  const place = new Map(held.map((value, index) => [value, index]))
  const kept = items.filter(item => place.has(key(item))).sort((a, b) => (place.get(key(a)) ?? 0) - (place.get(key(b)) ?? 0))

  return [...kept, ...items.filter(item => !place.has(key(item)))]
}
