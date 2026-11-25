import { useEffect, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

interface ClockEntry {
  now: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  appSub: { remove(): void } | null
}

const clocks = new Map<number, ClockEntry>()

function startTimer(intervalS: number, entry: ClockEntry) {
  if (entry.timer || AppState.currentState !== 'active') {
    return
  }

  entry.timer = setInterval(() => {
    entry.now = Date.now() / 1000
    entry.listeners.forEach(listener => listener())
  }, intervalS * 1000)
}

function stopTimer(entry: ClockEntry) {
  if (entry.timer) {
    clearInterval(entry.timer)
    entry.timer = null
  }
}

function getClock(intervalS: number): ClockEntry {
  let entry = clocks.get(intervalS)

  if (!entry) {
    entry = { now: Date.now() / 1000, listeners: new Set(), timer: null, appSub: null }
    clocks.set(intervalS, entry)
  }

  return entry
}

function subscribeClock(intervalS: number, listener: () => void): () => void {
  const entry = getClock(intervalS)

  if (entry.listeners.size === 0) {
    // Refresh stale snapshot when the first active consumer mounts after an idle stretch.
    const current = Date.now() / 1000

    if (current - entry.now >= intervalS) {
      entry.now = current
    }

    startTimer(intervalS, entry)
    entry.appSub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        entry.now = Date.now() / 1000
        entry.listeners.forEach(fn => fn())
        startTimer(intervalS, entry)
      } else {
        stopTimer(entry)
      }
    })
  }

  entry.listeners.add(listener)

  return () => {
    entry.listeners.delete(listener)

    if (entry.listeners.size === 0) {
      stopTimer(entry)
      entry.appSub?.remove()
      entry.appSub = null
    }
  }
}

/**
 * The current time in seconds, refreshed every `intervalS` seconds while the app is active.
 * Callers sharing the same `intervalS` share a single timer and snapshot.
 */
export function useNow(intervalS = 30): number {
  return useSyncExternalStore(
    listener => subscribeClock(intervalS, listener),
    () => getClock(intervalS).now,
  )
}

/** The current time in milliseconds, refreshed every `intervalMs` while `active` (and at once when it becomes active); frozen otherwise. */
export function useNowMs(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      return
    }

    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, intervalMs)

    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [active, intervalMs])

  return now
}
