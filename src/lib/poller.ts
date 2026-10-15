import { AppState } from 'react-native'

/**
 * Runs `task` now, then every `intervalMs` while `enabled()` is true, and again the moment the app
 * returns to the foreground. Phones suspend timers in the background, so nothing polls there.
 * Returns the function that stops it.
 */
export function startPoller(task: () => void | Promise<void>, intervalMs: number, enabled: () => boolean = () => true): () => void {
  const tick = () => {
    if (AppState.currentState === 'active' && enabled()) {
      void task()
    }
  }

  tick()
  const timer = setInterval(tick, intervalMs)
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
