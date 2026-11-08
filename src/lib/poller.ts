import { AppState } from 'react-native'

/**
 * Runs `task` now, then every `intervalMs` while `enabled()` is true, and again the moment the app
 * returns to the foreground. Phones suspend timers in the background, so nothing polls there.
 * `intervalMs` may be a function, read each second: a poll that becomes a rare safety check once the server pushes
 * what it was asking about. Returns the function that stops it.
 */
export function startPoller(task: () => void | Promise<void>, intervalMs: number | (() => number), enabled: () => boolean = () => true): () => void {
  let last = 0
  const tick = () => {
    if (AppState.currentState === 'active' && enabled()) {
      last = Date.now()
      void task()
    }
  }
  const due = typeof intervalMs === 'function' ? () => Date.now() - last >= intervalMs() - 250 && tick() : tick

  tick()
  const timer = setInterval(due, typeof intervalMs === 'function' ? 1_000 : intervalMs)
  const subscription = AppState.addEventListener('change', state => {
    if (state === 'active') {
      tick()
    }
  })

  return () => {
    clearInterval(timer)
    subscription.remove()
  }
}
