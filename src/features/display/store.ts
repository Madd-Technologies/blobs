/**
 * Each bot's Bot Screen: whether the host can run it, whether it is running, who holds the lease, the last
 * thumbnail, and the host-package install. Framework-free: the app wraps it with a hook and passes in the
 * gateway client. Contract: Hermes's `tui_gateway/contracts/display.py` (0.21.5+).
 *
 * Two rules from the server shape everything here:
 *  - A viewer id is minted per connection. The lease names its holder by a hash of it, so "is this me?" is
 *    a hash comparison, and after a reconnect the old id is dead (we mint a new one rather than reuse it).
 *  - The lease is the whole control model: `agent` drives unless a `human` holds it, last writer wins.
 */

import { createStore, type StoreApi } from 'zustand/vanilla'

import { JsonRpcGatewayError, type GatewayEvent } from '../../lib/hermes/gateway-client.ts'
import { RpcCode, type DisplayLease, type DisplayStatus } from '../../lib/hermes/protocol.ts'
import { call, isRpcCode, type RpcClient } from '../../lib/hermes/rpc.ts'
import type { RequestBridge } from '../../lib/hermes/server-requests.ts'

/** `unknown` until the first answer; `no` when the server has no Bot Screen at all (Hermes 0.21.0). */
export type Support = 'unknown' | 'yes' | 'no'

/** Something the server is doing for this screen right now. */
export type Busy = 'starting' | 'stopping' | 'installing' | null

export interface ViewerId {
  id: string
  /** `sha256(id)[:12]`, to recognise this viewer in `lease.viewer_hash`. */
  hash: string
  /** The connection it was minted on (see `getGeneration`). */
  generation: number
}

export interface ScreenState {
  profile: string
  support: Support
  status: DisplayStatus | null
  busy: Busy
  error: string | null
  /** The last frame, a JPEG data URL. Kept while a later grab fails or is withheld. */
  thumbnail: string | null
  /** The server withholds frames while a human holds the screen: they may be typing a password. */
  withheld: boolean
  /** The tail of the package manager's output while installing. */
  installLog: string[]
  /** The install is waiting on a sudo password (the host has none cached); answer with `answerSudo`. */
  needsSudo: boolean
  viewer: ViewerId | null
}

export interface DisplayState {
  screens: Record<string, ScreenState>
}

export interface DisplayDeps {
  client: RpcClient
  /** Gateway events (`display.status`, `display.lease`, `display.install.*`). */
  onEvent: (handler: (event: GatewayEvent) => void) => () => void
  /** Bumps on every reconnect; a viewer id minted on an older one is dead. */
  getGeneration: () => number
  /** Lowercase hex SHA-256 of a string. */
  sha256Hex: (input: string) => Promise<string>
  /** Where `display.install.sudo` requests arrive, and how to answer them. Absent: they are not handled. */
  requests?: Pick<RequestBridge, 'onRequest' | 'respond'>
}

export interface Observed {
  ticket: string
  path: string
  viewerId: string
}

const INSTALL_LOG_LINES = 40

export function blankScreen(profile: string): ScreenState {
  return { profile, support: 'unknown', status: null, busy: null, error: null, thumbnail: null, withheld: false, installLog: [], needsSudo: false, viewer: null }
}

/** A short sentence for something the server refused or that failed on the way. */
export function describeDisplayError(error: unknown): string {
  if (error instanceof JsonRpcGatewayError) {
    if (error.code === RpcCode.Display) {
      return error.message || 'The screen could not do that.'
    }

    return error.message || 'The server refused that.'
  }

  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** True when this lease is held by the viewer with this hash. */
export function isMine(lease: DisplayLease | undefined, viewer: ViewerId | null): boolean {
  return !!lease && lease.holder === 'human' && !!viewer && lease.viewer_hash === viewer.hash
}

export function createDisplay(deps: DisplayDeps) {
  const store: StoreApi<DisplayState> = createStore<DisplayState>(() => ({ screens: {} }))
  /** `profile_key` (the profile's home) -> profile name, learned from status snapshots. */
  const profileOfKey = new Map<string, string>()
  /** The open `display.install.sudo` request of each profile: the frame to answer. Never put in state. */
  const sudoFrames = new Map<string, string | number>()

  const get = (profile: string): ScreenState => store.getState().screens[profile] ?? blankScreen(profile)

  function patch(profile: string, change: Partial<ScreenState> | ((screen: ScreenState) => Partial<ScreenState>)) {
    store.setState(state => {
      const screen = state.screens[profile] ?? blankScreen(profile)

      return { screens: { ...state.screens, [profile]: { ...screen, ...(typeof change === 'function' ? change(screen) : change) } } }
    })
  }

  function setStatus(status: DisplayStatus) {
    profileOfKey.set(status.profile_key, status.profile)
    patch(status.profile, { status, support: 'yes', error: null })
  }

  // ── events ──────────────────────────────────────────────────────────────────────────────────────

  const stopEvents = deps.onEvent(event => {
    const payload = (event.payload ?? {}) as Record<string, unknown>
    const key = typeof payload.profile_key === 'string' ? payload.profile_key : undefined

    switch (event.type as string) {
      case 'request.cancel': {
        // The server withdrew a sudo ask (timed out, or the install ended): drop the password field.
        for (const [profile, frameId] of sudoFrames) {
          if (String(frameId) === String(payload.id)) {
            sudoFrames.delete(profile)
            patch(profile, { needsSudo: false })
          }
        }

        return
      }

      case 'display.status': {
        // A full snapshot, also for starts and stops made outside this app.
        setStatus(payload as unknown as DisplayStatus)

        return
      }

      case 'display.lease': {
        const profile = key ? profileOfKey.get(key) : undefined

        if (profile && payload.lease) {
          patch(profile, screen => (screen.status ? { status: { ...screen.status, lease: payload.lease as DisplayLease } } : {}))
        }

        return
      }

      case 'display.install.log': {
        const profile = key ? profileOfKey.get(key) : undefined
        const line = typeof payload.line === 'string' ? payload.line : ''

        if (profile && line) {
          patch(profile, screen => ({ installLog: [...screen.installLog, line].slice(-INSTALL_LOG_LINES) }))
        }

        return
      }

      case 'display.install.done': {
        const profile = key ? profileOfKey.get(key) : undefined

        if (profile) {
          const status = payload.status as DisplayStatus | undefined

          if (status) {
            setStatus(status)
          }

          const code = typeof payload.code === 'number' ? payload.code : 1
          // 0 ok, -1 cancelled (no sudo password), -2 no sudo on the host: the command to run by hand was streamed.
          const failure = code === 0 ? null : code === -1 ? 'The install was cancelled.' : code === -2 ? 'This host has no sudo. Run the install command on it as root.' : `The install failed (exit ${code}).`
          sudoFrames.delete(profile)
          patch(profile, { busy: null, needsSudo: false, error: failure })
        }
      }
    }
  })

  const stopSudo = deps.requests?.onRequest('display.install.sudo', frame => {
    const key = typeof frame.params.profile_key === 'string' ? frame.params.profile_key : undefined
    const profile = key ? profileOfKey.get(key) : undefined

    if (!profile) {
      // Not an install this app started (or a screen it has never read): nobody here to ask.
      deps.requests?.respond(frame.id, { value: '' })

      return
    }

    sudoFrames.set(profile, frame.id)
    patch(profile, { needsSudo: true })
  })

  /** Answers the install's sudo ask. Sent and forgotten: the password is never put in state. `''` skips it. */
  function answerSudo(profile: string, value: string): boolean {
    const frameId = sudoFrames.get(profile)

    if (frameId === undefined || !deps.requests) {
      return false
    }

    sudoFrames.delete(profile)
    patch(profile, { needsSudo: false })

    return deps.requests.respond(frameId, { value })
  }

  // ── reading ─────────────────────────────────────────────────────────────────────────────────────

  async function refresh(profile: string): Promise<void> {
    try {
      setStatus(await call(deps.client, 'display.status', { profile }))
    } catch (error) {
      if (isRpcCode(error, RpcCode.MethodNotFound)) {
        patch(profile, { support: 'no', error: null })

        return
      }

      patch(profile, { error: describeDisplayError(error) })
    }
  }

  async function refreshAll(profiles: string[]): Promise<void> {
    await Promise.all(profiles.map(profile => refresh(profile)))
  }

  /** One grab of the screen. Withheld (not an error) while a human holds it. */
  async function thumbnail(profile: string): Promise<void> {
    if (!get(profile).status?.running) {
      return
    }

    try {
      const { data_url: dataUrl, suppressed } = await call(deps.client, 'display.thumbnail', { profile })

      patch(profile, screen => ({ thumbnail: dataUrl ?? screen.thumbnail, withheld: !!suppressed }))
    } catch {
      // A missed frame is not worth a message: the next poll tries again.
    }
  }

  // ── doing ───────────────────────────────────────────────────────────────────────────────────────

  async function start(profile: string): Promise<void> {
    patch(profile, { busy: 'starting', error: null })

    try {
      setStatus(await call(deps.client, 'display.start', { profile }, { timeoutMs: 60_000 }))
      patch(profile, { busy: null })
    } catch (error) {
      patch(profile, { busy: null, error: describeDisplayError(error) })
    }
  }

  /** Refused while a human holds the screen unless `force`. */
  async function stop(profile: string, force = false): Promise<void> {
    patch(profile, { busy: 'stopping', error: null })

    try {
      setStatus(await call(deps.client, 'display.stop', { profile, ...(force ? { force: true } : {}) }))
      patch(profile, { busy: null, thumbnail: null, withheld: false })
    } catch (error) {
      patch(profile, { busy: null, error: describeDisplayError(error) })
    }
  }

  /** Starts the host's package install. Progress and the result arrive as events. */
  async function install(profile: string): Promise<void> {
    patch(profile, { busy: 'installing', error: null, installLog: [] })

    try {
      await call(deps.client, 'display.install', { profile }, { timeoutMs: 30_000 })
    } catch (error) {
      patch(profile, { busy: null, error: describeDisplayError(error) })
    }
  }

  /** This connection's viewer id for the screen, or null if it was minted on an older connection. */
  function viewerFor(profile: string): ViewerId | null {
    const viewer = get(profile).viewer

    return viewer && viewer.generation === deps.getGeneration() ? viewer : null
  }

  /**
   * A ticket to open the display websocket, and this connection's viewer id (minted on first use, kept
   * across calls on the same connection). The ticket is single-use and lasts 30 s, so ask right before
   * connecting.
   */
  async function observe(profile: string): Promise<Observed> {
    const known = viewerFor(profile)
    const result = await call(deps.client, 'display.observe', { profile, ...(known ? { viewer_id: known.id } : {}) })
    setStatus(result)

    if (known?.id !== result.viewer_id) {
      patch(profile, { viewer: { id: result.viewer_id, hash: (await deps.sha256Hex(result.viewer_id)).slice(0, 12), generation: deps.getGeneration() } })
    }

    return { ticket: result.ticket, path: result.path, viewerId: result.viewer_id }
  }

  /** Take over: this viewer drives, the agent pauses. Evicts whoever else held it. */
  async function takeOver(profile: string, reason?: string): Promise<void> {
    patch(profile, { error: null })

    try {
      const viewer = viewerFor(profile) ?? (await observe(profile).then(() => viewerFor(profile)))

      if (!viewer) {
        throw new Error('Could not identify this viewer.')
      }

      const { lease } = await call(deps.client, 'display.lease.acquire', { profile, viewer_id: viewer.id, ...(reason ? { reason } : {}) })
      patch(profile, screen => (screen.status ? { status: { ...screen.status, lease } } : {}))
    } catch (error) {
      patch(profile, { error: describeDisplayError(error) })
      throw error
    }
  }

  /** Hand back: the agent resumes. `force` releases whoever holds it, for a lease left by a dead viewer. */
  async function handBack(profile: string, force = false): Promise<void> {
    patch(profile, { error: null })

    try {
      const viewer = viewerFor(profile)
      const { lease } = await call(deps.client, 'display.lease.release', { profile, ...(viewer ? { viewer_id: viewer.id } : {}), ...(force || !viewer ? { force: true } : {}) })
      patch(profile, screen => (screen.status ? { status: { ...screen.status, lease } } : {}))
    } catch (error) {
      patch(profile, { error: describeDisplayError(error) })
      throw error
    }
  }

  function clearError(profile: string) {
    patch(profile, { error: null })
  }

  function dispose() {
    stopEvents()
    stopSudo?.()
  }

  return { store, get, refresh, refreshAll, thumbnail, start, stop, install, answerSudo, observe, takeOver, handBack, viewerFor, clearError, dispose }
}

export type Display = ReturnType<typeof createDisplay>
