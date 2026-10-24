/**
 * Turns a burst of "something changed" signals into few runs of `task`: the first signal runs it after `delayMs`, and signals
 * that arrive while it waits or within `minGapMs` of the last run are folded into one more run once that gap has passed.
 * Hermes sends `sessions.changed` up to every 2 s while any bot is writing, and each one used to cost a full re-read.
 * Pure of React Native (timers only), so Node can test it. Returns `{ signal, cancel }`.
 */
export function coalesce(task: () => void, options: { delayMs: number; minGapMs: number; now?: () => number }): { signal: () => void; cancel: () => void } {
  const now = options.now ?? (() => Date.now())
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRun = Number.NEGATIVE_INFINITY

  return {
    signal: () => {
      if (timer) {
        return
      }

      const wait = Math.max(options.delayMs, lastRun + options.minGapMs - now())
      timer = setTimeout(() => {
        timer = null
        lastRun = now()
        task()
      }, wait)
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
