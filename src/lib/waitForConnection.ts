import { useConnection } from '@/stores/connection'

const CONNECT_WAIT_MS = 10_000

/** Resolves true once an active server config is available, or false after timeout. */
export function waitForConnection(timeoutMs = CONNECT_WAIT_MS): Promise<boolean> {
  return new Promise(resolve => {
    if (useConnection.getState().config) {
      resolve(true)
      return
    }

    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, timeoutMs)

    const stop = useConnection.subscribe(state => {
      if (state.config) {
        clearTimeout(timer)
        stop()
        resolve(true)
      }
    })
  })
}
