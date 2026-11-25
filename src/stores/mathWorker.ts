import { create } from 'zustand'

import { cacheMathPicture, getCachedMathPicture, mathCacheKey, parseMathSvg } from '@/lib/math'

export interface PendingMathJob {
  key: string
  tex: string
  display: boolean
}

interface MathWorkerState {
  /** Stays false (zero WebView overhead) until a message first renders math. */
  active: boolean
  pending: PendingMathJob[]
  versions: Record<string, number>
}

const inFlight = new Set<string>()
const keyMeta = new Map<string, { tex: string; display: boolean }>()

export const useMathWorker = create<MathWorkerState>(() => ({
  active: false,
  pending: [],
  versions: {},
}))

export function requestMath(tex: string, display: boolean): void {
  const trimmed = tex.trim()

  if (!trimmed || getCachedMathPicture(trimmed, display) !== undefined) {
    return
  }

  const key = mathCacheKey(trimmed, display)

  if (inFlight.has(key)) {
    return
  }

  inFlight.add(key)
  keyMeta.set(key, { tex: trimmed, display })
  useMathWorker.setState(state => ({
    active: true,
    pending: [...state.pending, { key, tex: trimmed, display }],
  }))
}

export function resolveMath(key: string, svg: string | null): void {
  inFlight.delete(key)
  const meta = keyMeta.get(key)
  keyMeta.delete(key)

  if (meta) {
    cacheMathPicture(meta.tex, meta.display, parseMathSvg(svg))
  }

  useMathWorker.setState(state => ({
    pending: state.pending.filter(item => item.key !== key),
    versions: { ...state.versions, [key]: (state.versions[key] ?? 0) + 1 },
  }))
}
