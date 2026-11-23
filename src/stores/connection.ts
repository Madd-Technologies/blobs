import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'
import { create } from 'zustand'

import { JsonRpcGatewayClient, type ConnectionState, type GatewayEvent } from '@/lib/hermes/gateway-client'
import { SignInError } from '@/lib/hermes/auth'
import { createKeeper, refreshDelayMs } from '@/lib/hermes/keeper'
import { advertiseServerRequests, createRequestBridge } from '@/lib/hermes/server-requests'
import { gatewayWsUrl, HermesHttpError, normalizeBaseUrl, probeServer, type ServerConfig } from '@/lib/hermes/server'
import {
  EMPTY_SERVER_INDEX,
  LEGACY_SERVER_KEY,
  makeServerId,
  parseServerIndex,
  removeServerMeta,
  renameServerMeta,
  SERVER_INDEX_KEY,
  serverKey,
  upsertServerMeta,
  type SavedServerMeta,
  type ServerIndex,
} from '@/lib/hermes/servers'
import { secure } from '@/lib/secure'
import { runServerResets } from '@/stores/reset'

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
  servers: SavedServerMeta[]
  activeServerId: string | null
  hydrated: boolean
  status: Status
  lastError: string | null
  /** Set when a saved session could no longer be renewed; the Connect screen shows it. */
  signedOut: SignedOut | null
  /** Bumps on every successful (re)connect so screens can re-resume sessions. */
  generation: number
  /** The Hermes version the server reported when it was last reached (`/api/status`); null when it did not say. */
  serverVersion: string | null
  hydrate: () => Promise<void>
  saveConfig: (config: ServerConfig, label?: string) => Promise<void>
  restoreSnapshot: (config: ServerConfig | null, serverId: string | null, servers: SavedServerMeta[]) => Promise<void>
  switchServer: (id: string) => Promise<string | null>
  removeServer: (id: string) => Promise<void>
  renameServer: (id: string, label: string) => Promise<void>
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

function clearTimers() {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }

  stopStableTimer()
  attempt = 0
}

async function persistIndex(index: ServerIndex): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVER_INDEX_KEY, JSON.stringify(index))
  } catch {
    // Best-effort metadata persistence; credentials remain safe in SecureStore.
  }
}

async function readStoredConfig(id: string): Promise<ServerConfig | null> {
  try {
    const raw = await secure.get(serverKey(id))

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<ServerConfig>

    if (!parsed || typeof parsed.baseUrl !== 'string' || !parsed.auth) {
      return null
    }

    return { baseUrl: normalizeBaseUrl(parsed.baseUrl), auth: parsed.auth }
  } catch {
    await secure.remove(serverKey(id)).catch(() => undefined)

    return null
  }
}

const nowS = () => Date.now() / 1000

/** Renews signed-in sessions' tokens one at a time (see `keeper.ts`). */
const keeper = createKeeper({
  getConfig: () => useConnection.getState().config,
  nowS,
  apply: async nextConfig => {
    const { activeServerId, config: current } = useConnection.getState()

    if (!activeServerId || !current || current.baseUrl !== nextConfig.baseUrl) {
      return
    }

    await secure.set(serverKey(activeServerId), JSON.stringify(nextConfig))
    useConnection.setState({ config: nextConfig })
    scheduleRefresh()
  },
})

function renewIn(ms: number) {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }

  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void useConnection.getState().renew()
  }, ms)
}

function scheduleRefresh() {
  const { config } = useConnection.getState()

  if (config?.auth.kind !== 'oauth') {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }

    return
  }

  renewIn(Math.min(refreshDelayMs(config.auth, nowS()), 2 ** 30))
}

function scheduleRetry(connect: () => Promise<void>) {
  if (retryTimer) {
    return
  }

  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
  attempt++
  retryTimer = setTimeout(() => {
    retryTimer = null
    void connect()
  }, delay)
}

const CONNECT_DEADLINE_MS = 30_000

class ConnectTimeout extends Error {
  constructor() {
    super('Connecting took too long.')
    this.name = 'ConnectTimeout'
  }
}

export const useConnection = create<ConnectionStore>((set, get) => ({
  config: null,
  servers: [],
  activeServerId: null,
  hydrated: false,
  status: 'unconfigured',
  lastError: null,
  signedOut: null,
  generation: 0,
  serverVersion: null,

  hydrate: async () => {
    let index = EMPTY_SERVER_INDEX

    try {
      index = parseServerIndex(await AsyncStorage.getItem(SERVER_INDEX_KEY))
    } catch {
      index = EMPTY_SERVER_INDEX
    }

    // Migrate legacy single-server SecureStore key on first launch with multi-server index.
    if (index.servers.length === 0) {
      try {
        const legacyRaw = await secure.get(LEGACY_SERVER_KEY)

        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw) as Partial<ServerConfig>

          if (parsed && typeof parsed.baseUrl === 'string' && parsed.auth) {
            const normalized: ServerConfig = { baseUrl: normalizeBaseUrl(parsed.baseUrl), auth: parsed.auth }
            const id = makeServerId()
            const migrated = upsertServerMeta(EMPTY_SERVER_INDEX, normalized, { id })
            await secure.set(serverKey(id), JSON.stringify(normalized))
            await persistIndex(migrated.index)
            index = migrated.index
          }

          await secure.remove(LEGACY_SERVER_KEY).catch(() => undefined)
        }
      } catch {
        await secure.remove(LEGACY_SERVER_KEY).catch(() => undefined)
      }
    }

    let config: ServerConfig | null = null
    let activeId = index.activeId

    if (activeId) {
      config = await readStoredConfig(activeId)

      if (!config) {
        index = removeServerMeta(index, activeId)
        activeId = index.activeId

        if (activeId) {
          config = await readStoredConfig(activeId)

          if (!config) {
            index = removeServerMeta(index, activeId)
            activeId = null
          }
        }

        await persistIndex(index)
      }
    }

    set({
      config,
      servers: index.servers,
      activeServerId: config ? activeId : null,
      hydrated: true,
      status: config ? 'connecting' : 'unconfigured',
    })
    runServerResets(config?.baseUrl ?? null)
    scheduleRefresh()
  },

  saveConfig: async (rawConfig, label) => {
    const config: ServerConfig = { ...rawConfig, baseUrl: normalizeBaseUrl(rawConfig.baseUrl) }
    const previousBaseUrl = get().config?.baseUrl ?? null
    const currentIndex: ServerIndex = { activeId: get().activeServerId, servers: get().servers }
    const { index, server } = upsertServerMeta(currentIndex, config, { label })

    await secure.set(serverKey(server.id), JSON.stringify(config))
    await persistIndex(index)
    gateway.close()
    clearTimers()

    const switched = previousBaseUrl !== config.baseUrl

    set({
      config,
      servers: index.servers,
      activeServerId: server.id,
      status: 'offline',
      lastError: null,
      signedOut: null,
      ...(switched ? { serverVersion: null } : {}),
    })

    if (switched) {
      runServerResets(config.baseUrl)
    }

    scheduleRefresh()
    await get().connect()
  },

  restoreSnapshot: async (config, serverId, servers) => {
    const previousBaseUrl = get().config?.baseUrl ?? null
    const index: ServerIndex = { activeId: serverId, servers }

    if (config && serverId) {
      await secure.set(serverKey(serverId), JSON.stringify(config))
    }

    await persistIndex(index)
    gateway.close()
    clearTimers()

    const nextBaseUrl = config?.baseUrl ?? null
    set({
      config,
      servers,
      activeServerId: serverId,
      status: config ? 'connecting' : 'unconfigured',
      lastError: null,
      signedOut: null,
      serverVersion: previousBaseUrl === nextBaseUrl ? get().serverVersion : null,
    })

    if (previousBaseUrl !== nextBaseUrl) {
      runServerResets(nextBaseUrl)
    }

    scheduleRefresh()

    if (config) {
      void get().connect()
    }
  },

  switchServer: async id => {
    const target = get().servers.find(server => server.id === id)

    if (!target) {
      return 'Server not found.'
    }

    const nextConfig = await readStoredConfig(id)

    if (!nextConfig) {
      await get().removeServer(id)

      return 'Saved credentials for this server are missing. Add the server again.'
    }

    const previousBaseUrl = get().config?.baseUrl ?? null
    const now = Date.now()
    const nextServers = get().servers.map(server => (server.id === id ? { ...server, lastConnectedAt: now } : server))
    const nextIndex: ServerIndex = { activeId: id, servers: nextServers }

    await persistIndex(nextIndex)
    gateway.close()
    clearTimers()

    set({
      config: nextConfig,
      servers: nextServers,
      activeServerId: id,
      status: 'connecting',
      lastError: null,
      signedOut: null,
      serverVersion: null,
    })

    if (previousBaseUrl !== nextConfig.baseUrl) {
      runServerResets(nextConfig.baseUrl)
    }

    scheduleRefresh()
    void get().connect()

    return null
  },

  removeServer: async id => {
    await secure.remove(serverKey(id)).catch(() => undefined)
    const currentIndex: ServerIndex = { activeId: get().activeServerId, servers: get().servers }
    const nextIndex = removeServerMeta(currentIndex, id)
    await persistIndex(nextIndex)

    if (id !== get().activeServerId) {
      set({ servers: nextIndex.servers })

      return
    }

    gateway.close()
    clearTimers()

    if (nextIndex.activeId) {
      const fallbackConfig = await readStoredConfig(nextIndex.activeId)

      if (fallbackConfig) {
        const previousBaseUrl = get().config?.baseUrl ?? null
        set({
          config: fallbackConfig,
          servers: nextIndex.servers,
          activeServerId: nextIndex.activeId,
          status: 'connecting',
          lastError: null,
          signedOut: null,
          serverVersion: null,
        })

        if (previousBaseUrl !== fallbackConfig.baseUrl) {
          runServerResets(fallbackConfig.baseUrl)
        }

        scheduleRefresh()
        void get().connect()

        return
      }

      const cleaned = removeServerMeta(nextIndex, nextIndex.activeId)
      await persistIndex(cleaned)
      set({
        config: null,
        servers: cleaned.servers,
        activeServerId: null,
        status: 'unconfigured',
        lastError: null,
        signedOut: null,
        serverVersion: null,
      })
      runServerResets(null)
      scheduleRefresh()

      return
    }

    set({
      config: null,
      servers: [],
      activeServerId: null,
      status: 'unconfigured',
      lastError: null,
      signedOut: null,
      serverVersion: null,
    })
    runServerResets(null)
    scheduleRefresh()
  },

  renameServer: async (id, label) => {
    const nextIndex = renameServerMeta({ activeId: get().activeServerId, servers: get().servers }, id, label)
    await persistIndex(nextIndex)
    set({ servers: nextIndex.servers })
  },

  forget: async () => {
    const activeId = get().activeServerId

    if (activeId) {
      await get().removeServer(activeId)

      return
    }

    await secure.remove(LEGACY_SERVER_KEY).catch(() => undefined)
    gateway.close()
    clearTimers()
    set({ config: null, servers: [], activeServerId: null, status: 'unconfigured', lastError: null, signedOut: null, serverVersion: null })
    runServerResets(null)
    scheduleRefresh()
  },

  renew: async () => {
    try {
      await keeper.fresh()
      scheduleRefresh()
    } catch (error) {
      if (error instanceof SignInError && error.kind === 'expired') {
        await signOut(get)
      } else {
        renewIn(30_000)
      }
    }
  },

  connect: async () => {
    const { config } = get()
    if (!config) return
    if (gateway.connectionState === 'open' || gateway.connectionState === 'connecting') return
    const targetUrl = config.baseUrl
    set({ status: 'connecting' })
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new ConnectTimeout()), CONNECT_DEADLINE_MS)
    })

    try {
      const probePromise = probeServer(config.baseUrl).then(
        probe => probe.version ?? null,
        () => null,
      )
      let versionTimer: ReturnType<typeof setTimeout> | undefined
      const versionFallback = new Promise<string | null>(resolve => {
        versionTimer = setTimeout(() => resolve(get().serverVersion), 1_500)
      })

      const [asked, version] = await Promise.race([
        (async () => {
          await gateway.connect(await openUrl())

          return Promise.all([advertiseServerRequests(gateway), Promise.race([probePromise, versionFallback]).finally(() => clearTimeout(versionTimer))])
        })(),
        deadline,
      ])

      if (get().config?.baseUrl !== targetUrl) {
        return
      }

      void probePromise.then(resolved => {
        if (resolved && get().config?.baseUrl === targetUrl && get().serverVersion !== resolved) {
          set({ serverVersion: resolved })
        }
      })

      if (__DEV__) {
        console.log(`[gateway] server requests: ${asked.length ? asked.join(', ') : 'none (older server)'}`)
      }

      startStableTimer()
      set(s => ({ status: 'online', lastError: null, serverVersion: version, generation: s.generation + 1 }))
    } catch (error) {
      if (get().config?.baseUrl !== targetUrl) {
        return
      }

      if (error instanceof SignInError && error.kind === 'expired') {
        await signOut(get)

        return
      }

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

async function signOut(get: () => ConnectionStore) {
  const { config, activeServerId, servers } = get()

  if (activeServerId) {
    await secure.remove(serverKey(activeServerId)).catch(() => undefined)
    const nextIndex = removeServerMeta({ activeId: activeServerId, servers }, activeServerId)
    await persistIndex({ activeId: null, servers: nextIndex.servers })
  } else {
    await secure.remove(LEGACY_SERVER_KEY).catch(() => undefined)
  }

  gateway.close()
  clearTimers()
  useConnection.setState(state => ({
    config: null,
    activeServerId: null,
    servers: state.servers.filter(server => server.id !== activeServerId),
    status: 'unconfigured',
    lastError: null,
    serverVersion: null,
    signedOut: config
      ? { baseUrl: config.baseUrl, user: config.auth.kind === 'oauth' ? config.auth.user : undefined, reason: 'Your session has expired. Sign in again.' }
      : null,
  }))
  runServerResets(null)
  scheduleRefresh()
}

if (__DEV__) {
  gateway.onState(state => console.log(`[gateway] ${state}`))
}

gateway.onState((state: ConnectionState) => {
  const store = useConnection.getState()
  if ((state === 'closed' || state === 'error') && store.config) {
    stopStableTimer()
    useConnection.setState({ status: 'offline', lastError: store.lastError ?? 'The server closed the connection.' })
    scheduleRetry(store.connect)
  }
})

AppState.addEventListener('change', next => {
  if (next === 'active') {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }

    void useConnection
      .getState()
      .renew()
      .then(() => useConnection.getState().connect())
  }
})

export function onGatewayEvent(handler: (event: GatewayEvent) => void): () => void {
  return requests.onEvent(handler)
}
