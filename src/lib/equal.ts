/** Structural deep equality for JSON values without serialization overhead. Pure: no React Native. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false

    for (let index = 0; index < a.length; index++) {
      if (!sameJson(a[index], b[index])) return false
    }

    return true
  }

  if (!isRecord(a) || !isRecord(b)) return false

  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!Object.hasOwn(b, key) || !sameJson(a[key], b[key])) return false
  }

  return true
}
