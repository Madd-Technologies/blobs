/**
 * Where the Hermes backend lives and how to authenticate to it.
 *
 * Two auth modes mirror `hermes serve`'s own:
 *  - `token`  — loopback mode (dev): fixed HERMES_DASHBOARD_SESSION_TOKEN. WS uses `?token=`,
 *               REST uses `X-Hermes-Session-Token`.
 *  - `oauth`  — gated mode (a remote server, e.g. over Tailscale): bearer access token for REST; WebSockets can't send
 *               headers, so each connect mints a single-use 30 s ticket via POST /api/auth/ws-ticket.
 *
 * This module has no React Native imports so it can move into a shared package later.
 */

export type ServerAuth =
  | { kind: 'token'; token: string }
  | { kind: 'oauth'; accessToken: string; refreshToken: string; /** Epoch seconds. */ expiresAt: number; /** Which sign-in provider issued it (needed to refresh). */ provider?: string; /** Who is signed in, for display. */ user?: string }

export interface ServerConfig {
  /** e.g. http://127.0.0.1:9119 or https://my-server.your-tailnet.ts.net */
  baseUrl: string
  auth: ServerAuth
}

export function normalizeBaseUrl(input: string): string {
  let url = input.trim()
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  return url.replace(/\/+$/, '')
}

function wsOrigin(baseUrl: string): string {
  return baseUrl.replace(/^http/i, 'ws')
}

export function restHeaders(config: ServerConfig): Record<string, string> {
  return config.auth.kind === 'token'
    ? { 'X-Hermes-Session-Token': config.auth.token }
    : { Authorization: `Bearer ${config.auth.accessToken}` }
}

export class HermesHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HermesHttpError'
    this.status = status
  }
}

/**
 * `fetch` that gives up after `ms` (unless the caller brings its own signal). A request the network swallows otherwise hangs
 * for as long as the platform lets it: a minute on iOS, without end on Android.
 */
export async function fetchWithin(input: string, init: RequestInit, ms: number | undefined): Promise<Response> {
  if (!ms || init.signal) {
    return fetch(input, init)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    throw controller.signal.aborted ? new Error(`No answer from the server in ${Math.round(ms / 1000)} s.`) : error
  } finally {
    clearTimeout(timer)
  }
}

export async function restJson<T>(config: ServerConfig, path: string, init: RequestInit = {}, options: { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetchWithin(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...restHeaders(config),
      ...(init.headers as Record<string, string> | undefined),
    },
  }, options.timeoutMs)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new HermesHttpError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** How long one step of connecting (a ticket, a token refresh) may take before it counts as failed and is tried again. */
export const CONNECT_STEP_MS = 15_000

/** Fresh `/api/ws` URL. In oauth mode this mints a single-use ticket, so call it right before connecting. */
export async function gatewayWsUrl(config: ServerConfig): Promise<string> {
  const base = `${wsOrigin(config.baseUrl)}/api/ws`
  if (config.auth.kind === 'token') {
    return `${base}?token=${encodeURIComponent(config.auth.token)}`
  }
  const { ticket } = await restJson<{ ticket: string }>(config, '/api/auth/ws-ticket', { method: 'POST', body: '{}' }, { timeoutMs: CONNECT_STEP_MS })
  return `${base}?ticket=${encodeURIComponent(ticket)}`
}

export interface ProbeResult {
  ok: boolean
  authRequired?: boolean
  version?: string
  error?: string
  /** The address is a Hermes API server (OpenAI-compatible, usually port 8642), not the gateway the app needs. */
  apiServer?: boolean
}

/** Unauthenticated liveness probe: `/api/status` is public and reports whether auth is required. */
export async function probeServer(baseUrl: string): Promise<ProbeResult> {
  const get = async (path: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    try {
      return await fetch(`${baseUrl}${path}`, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const res = await get('/api/status')

    if (res.status === 404) {
      // Reachable but not the dashboard gateway. Hermes's API server answers /health instead.
      const health = await get('/health').then(
        r => (r.ok ? (r.json() as Promise<{ platform?: string }>) : null),
        () => null,
      )

      if (health?.platform === 'hermes-agent') {
        return { ok: false, error: 'HTTP 404', apiServer: true }
      }
    }

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }

    const body = (await res.json()) as { auth_required?: boolean; version?: string }

    return { ok: true, authRequired: body.auth_required, version: body.version }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
