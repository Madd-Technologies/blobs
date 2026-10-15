/**
 * Telling the server's push plugin (hermes-bot-mobile, or the older hermes-push) what this phone has on screen, so it does not push what you are already looking at:
 * while the app is in front, a finished reply is not pushed (Home shows it), and nothing at all is pushed for the chat or room on
 * screen. Only a phone registered for push says so (the server ignores any other). Repeated every 20 s while in front; the
 * server forgets it after 45 s, so a phone that dies or drops off the network simply stops counting. Pure: no React Native imports.
 */

export interface PresenceBody {
  /** The server's id for this phone. */
  device: string
  foreground: boolean
  /** The open chat's or room's session ids (live and stored). */
  sessions: string[]
}

export interface PresenceDeps {
  send: (body: PresenceBody) => Promise<unknown>
  every?: (run: () => void, ms: number) => () => void
}

export interface PresenceState {
  device: string | null
  foreground: boolean
  online: boolean
  sessions: string[]
}

export const REPEAT_MS = 20_000

const defaultEvery = (run: () => void, ms: number) => {
  const timer = setInterval(run, ms)

  return () => clearInterval(timer)
}

export function createPresence(deps: PresenceDeps) {
  const every = deps.every ?? defaultEvery
  let state: PresenceState = { device: null, foreground: true, online: false, sessions: [] }
  let last = ''
  let stopRepeat: (() => void) | null = null

  function send(force: boolean) {
    if (!state.device || !state.online) {
      return
    }

    const body: PresenceBody = { device: state.device, foreground: state.foreground, sessions: state.foreground ? state.sessions : [] }
    const key = JSON.stringify(body)

    if (key === last && !force) {
      return
    }

    last = key
    // A failed send is tried again on the next change or repeat.
    void deps.send(body).catch(() => {
      last = ''
    })
  }

  function sync() {
    const repeating = !!state.device && state.online && state.foreground

    if (repeating && !stopRepeat) {
      stopRepeat = every(() => send(true), REPEAT_MS)
    } else if (!repeating && stopRepeat) {
      stopRepeat()
      stopRepeat = null
    }

    send(false)
  }

  return {
    update(change: Partial<PresenceState>) {
      state = { ...state, ...change }
      sync()
    },
    stop() {
      stopRepeat?.()
      stopRepeat = null
    },
  }
}
