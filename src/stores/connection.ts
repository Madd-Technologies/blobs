import { AppState } from 'react-native'
import { create } from 'zustand'

import { JsonRpcGatewayClient, type ConnectionState, type GatewayEvent } from '@/lib/hermes/gateway-client'
import { SignInError } from '@/lib/hermes/auth'
import { createKeeper, refreshDelayMs } from '@/lib/hermes/keeper'
import { advertiseServerRequests, createRequestBridge } from '@/lib/hermes/server-requests'
import { gatewayWsUrl, HermesHttpError, type ServerConfig } from '@/lib/hermes/server'
import { secure } from '@/lib/secure'

const CONFIG_KEY = 'hermesbot.server'

/** One gateway client for the whole app; stores subscribe to its event stream. */
export const gateway = new JsonRpcGatewayClient({
  requestIdPrefix: 'm',
  // Dev only: why the server closed a socket (code and reason, never the URL, which carries a ticket).
  onSocketClose: event => {
    if (__DEV__) {
      console.log(`[gateway] socket closed: code ${event.code}${event.reason ? ` (${event.reason})` : ''}`)
    }

    return false
  },
})

/**
 * Prompts that a newer Hermes asks as requests (see `server-requests.ts`), as the events the stores read.
 * Everything that listens for gateway events goes through this, never the raw client.
 */
export const requests = createRequestBridge(gateway)

type Status = 'unconfigured' | 'connecting' | 'online' | 'offline'

/** Why the user was signed out, and what to prefill so signing back in is quick. */
interface SignedOut {
  baseUrl: string
  user?: string
  reason: string
}

interface ConnectionStore {
  config: ServerConfig | null
  hydrated: boolean
  status: Status
  lastError: string | null
  /** Set when a saved session could no longer be renewed; the Connect screen shows it. */
  signedOut: SignedOut | null
  /** Bumps on every successful (re)connect so screens can re-resume sessions. */
  generation: number
  hydrate: () => Promise<void>
  saveConfig: (config: ServerConfig) => Promise<void>
  forget: () => Promise<void>
  renew: () => Promise<void>
  connect: () => Promise<void>
}

let retryTimer: ReturnType<typeof setTimeout> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let stableTimer: ReturnType<typeof setTimeout> | null = null
let attempt = 0

/** A connection that stays up this long counts as healthy, and the next drop starts the backoff over. */
const STABLE_AFTER_MS = 10_000

/**
 * Resets the backoff only once a connection has proved stable. Resetting on every open meant a server that
 * accepts a socket and drops it straight away was redialled once a second, forever.
 */
function startStableTimer() {
  if (stableTimer) {
    clearTimeout(stableTimer)
  }

  stableTimer = setTimeout(() => {
    stableTimer = null
    attempt = 0
  }, STABLE_AFTER_MS)
}

function stopStableTimer() {
  if (stableTimer) {
    clearTimeout(stableTimer)
    stableTimer = null
  }
}

const nowS = () => Date.now() / 1000

/** Renews signed-in sessions' tokens one at a time (see `keeper.ts`). */
const keeper = createKeeper({
  getConfig: () => useConnection.getState().config,
  nowS,
  apply: async config => {
    await secure.set(CONFIG_KEY, JSON.stringify(config))
    useConnection.setState({ config })
    scheduleRefresh()
  },
})

/** Runs `renew` after `ms`, replacing any renewal already waiting. */
function renewIn(ms: number) {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void useConnection.getState().renew()
  }, ms)
}

/** Renews the tokens shortly before they run out, while the app is running. */
function scheduleRefresh() {
  const { config } = useConnection.getState()

  if (config?.auth.kind !== 'oauth') {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    return
  }

  // setTimeout caps at about 24 days; a token lasts hours, but stay inside the cap anyway.
  renewIn(Math.min(refreshDelayMs(config.auth, nowS()), 2 ** 30))
}

function scheduleRetry(connect: () => Promise<void>) {
  if (retryTimer) return
  // Exponential backoff capped at 30 s; foregrounding the app retries immediately.
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
  attempt++
  retryTimer = setTimeout(() => {
    retryTimer = null
    void connect()
  }, delay)
}

/** A connect attempt (token, ticket, socket, hello) that has not finished in this long is abandoned and tried again. */
const CONNECT_DEADLINE_MS = 30_000

class ConnectTimeout extends Error {
  constructor() {
    super('Connecting took too long.')
    this.name = 'ConnectTimeout'
  }
}

export const useConnection = create<ConnectionStore>((set, get) => ({
  config: null,
  hydrated: false,
  status: 'unconfigured',
  lastError: null,
  signedOut: null,
  generation: 0,

  hydrate: async () => {
    const raw = await secure.get(CONFIG_KEY)
    const config = raw ? (JSON.parse(raw) as ServerConfig) : null
    // A saved server is about to be dialled (the root layout connects right after this), so say
    // "connecting", not "offline": Home shows a can't-reach banner for the latter on every cold start.
    set({ config, hydrated: true, status: config ? 'connecting' : 'unconfigured' })
    scheduleRefresh()
  },

  saveConfig: async config => {
    await secure.set(CONFIG_KEY, JSON.stringify(config))
    gateway.close()
    attempt = 0
    set({ config, status: 'offline', lastError: null, signedOut: null })
    scheduleRefresh()
    await get().connect()
  },

  forget: async () => {
    await secure.remove(CONFIG_KEY)
    gateway.close()
    set({ config: null, status: 'unconfigured', signedOut: null })
    scheduleRefresh()
  },

  /** Renews the session's tokens if they are due (a no-op for a session token). */
  renew: async () => {
    try {
      await keeper.fresh()
      // Re-arm even when nothing was due (a timer can fire a hair early), so renewal never lapses.
      scheduleRefresh()
    } catch (error) {
      if (error instanceof SignInError && error.kind === 'expired') {
        await signOut(get)
      } else {
        // The server is unreachable right now: try again soon rather than signing the user out.
        renewIn(30_000)
      }
    }
  },

  connect: async () => {
    const { config } = get()
    if (!config) return
    if (gateway.connectionState === 'open' || gateway.connectionState === 'connecting') return
    set({ status: 'connecting' })
    // Some step that never answers would leave the app "Connecting…" for good: give the whole attempt a deadline.
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new ConnectTimeout()), CONNECT_DEADLINE_MS)
    })

    try {
      const asked = await Promise.race([
        (async () => {
          await gateway.connect(await openUrl())

          // Before any chat is opened: a newer server withdraws every prompt from a client that has not said
          // it can answer them. An older server has no such call and keeps using events.
          return advertiseServerRequests(gateway)
        })(),
        deadline,
      ])

      if (__DEV__) {
        console.log(`[gateway] server requests: ${asked.length ? asked.join(', ') : 'none (older server)'}`)
      }

      startStableTimer()
      set(s => ({ status: 'online', lastError: null, generation: s.generation + 1 }))
    } catch (error) {
      if (error instanceof SignInError && error.kind === 'expired') {
        await signOut(get)

        return
      }

      // Drop whatever the stuck attempt left half open, so the retry starts clean.
      if (error instanceof ConnectTimeout) {
        gateway.close()
      }

      if (__DEV__) {
        console.log(`[gateway] connect failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      set({ status: 'offline', lastError: error instanceof Error ? error.message : String(error) })
      scheduleRetry(get().connect)
    } finally {
      clearTimeout(watchdog)
    }
  },
}))

/**
 * A fresh websocket URL. Renews the tokens first when they are about to expire; if the server turns the
 * ticket request down anyway (it restarted, or revoked the session), renews once more before giving up.
 */
async function openUrl(): Promise<string> {
  const config = await keeper.fresh()

  if (!config) {
    throw new Error('Not connected to a server.')
  }

  try {
    return await gatewayWsUrl(config)
  } catch (error) {
    if (config.auth.kind === 'oauth' && error instanceof HermesHttpError && error.status === 401) {
      const renewed = await keeper.fresh(true)

      if (renewed) {
        return gatewayWsUrl(renewed)
      }
    }

    throw error
  }
}

/** The saved session can no longer be renewed: drop the credentials, keep the address, and say why. */
async function signOut(get: () => ConnectionStore) {
  const { config } = get()

  await secure.remove(CONFIG_KEY)
  gateway.close()
  useConnection.setState({
    config: null,
    status: 'unconfigured',
    signedOut: config
      ? { baseUrl: config.baseUrl, user: config.auth.kind === 'oauth' ? config.auth.user : undefined, reason: 'Your session has expired. Sign in again.' }
      : null,
  })
  scheduleRefresh()
}

// Dev only: trace socket state changes. Never log the URL: it carries the session token.
if (__DEV__) {
  gateway.onState(state => console.log(`[gateway] ${state}`))
}

// Socket drops → offline + backoff reconnect (the client itself replays missed events on reopen).
gateway.onState((state: ConnectionState) => {
  const store = useConnection.getState()
  if ((state === 'closed' || state === 'error') && store.config) {
    stopStableTimer()
    useConnection.setState({ status: 'offline', lastError: store.lastError ?? 'The server closed the connection.' })
    scheduleRetry(store.connect)
  }
})

// Mobile OSes kill sockets in the background; reconnect the moment we're foregrounded.
AppState.addEventListener('change', next => {
  if (next === 'active') {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    // The socket may still look open after a long sleep, so renew the tokens before anything else.
    void useConnection
      .getState()
      .renew()
      .then(() => useConnection.getState().connect())
  }
})

export function onGatewayEvent(handler: (event: GatewayEvent) => void): () => void {
  return requests.onEvent(handler)
}
