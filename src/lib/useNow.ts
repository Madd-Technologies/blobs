import { useEffect, useState } from 'react'

/** The current time in seconds, refreshed every `intervalS` seconds, so render stays pure. */
export function useNow(intervalS = 30): number {
  const [now, setNow] = useState(() => Date.now() / 1000)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), intervalS * 1000)

    return () => clearInterval(timer)
  }, [intervalS])

  return now
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
