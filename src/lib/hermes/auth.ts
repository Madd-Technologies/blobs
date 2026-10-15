/**
 * Signing in to a gated Hermes server (any non-loopback dashboard), the way Hermes Desktop does: the
 * gateway's RFC 8252 "native app" flow with PKCE. Pure: no React Native imports. Crypto and fetch are
 * injected so Node can test it and the app can supply `expo-crypto`.
 *
 *   1. GET  /auth/native/authorize   starts a pending login (sets a short-lived PKCE cookie)
 *   2. POST /auth/password-login     checks the username and password; with that cookie present the
 *                                     response is `{ok, next}` where `next` is the loopback redirect
 *                                     carrying a one-time `code`
 *   3. POST /auth/native/token       trades `code` + the PKCE verifier for bearer tokens
 *
 * Desktop would open `next` in a browser and catch it on a local listener. A phone has no need to:
 * `next` is only ever parsed here, never visited, so the loopback address in it is never used.
 * After that REST takes `Authorization: Bearer <access token>` and each websocket takes a single-use
 * ticket (see `gatewayWsUrl`). Tokens are rotated with `/auth/native/refresh`.
 */

import type { ServerAuth } from './server.ts'

export type OAuthAuth = Extract<ServerAuth, { kind: 'oauth' }>

export interface AuthDeps {
  /** SHA-256 of a string, as base64url without padding. */
  sha256: (input: string) => Promise<string>
  /** `bytes` random bytes, as base64url without padding. */
  random: (bytes: number) => string
  fetch?: typeof fetch
}

export interface AuthProviderInfo {
  name: string
  display_name: string
  supports_password: boolean
}

export type SignInFailure = 'invalid-credentials' | 'rate-limited' | 'unreachable' | 'unsupported' | 'expired' | 'server'

export class SignInError extends Error {
  readonly kind: SignInFailure

  constructor(kind: SignInFailure, message: string) {
    super(message)
    this.name = 'SignInError'
    this.kind = kind
  }
}

/** The server only requires a loopback literal here; nothing listens on it. */
const REDIRECT_URI = 'http://127.0.0.1:53682/callback'

function qs(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

async function detail(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)

  return typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`
}

/** The sign-in options the server advertises. Throws if the server has none (not a gated gateway). */
export async function fetchProviders(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<AuthProviderInfo[]> {
  const res = await fetchFn(`${baseUrl}/api/auth/providers`)

  if (!res.ok) {
    throw new SignInError('unsupported', `The server did not list any sign-in providers (${await detail(res)}).`)
  }

  const body = (await res.json()) as { providers?: AuthProviderInfo[] }

  return body.providers ?? []
}

/** Picks the provider to sign in with: the first one that takes a username and password. */
export function passwordProvider(providers: AuthProviderInfo[]): AuthProviderInfo | undefined {
  return providers.find(provider => provider.supports_password)
}

function tokensFrom(body: { access_token?: string; refresh_token?: string; expires_at?: number; provider?: string }, previous?: OAuthAuth): OAuthAuth {
  if (!body.access_token || !body.refresh_token || typeof body.expires_at !== 'number') {
    throw new SignInError('server', 'The server returned an incomplete session.')
  }

  return {
    kind: 'oauth',
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
    provider: body.provider ?? previous?.provider,
    user: previous?.user,
  }
}

/** Signs in with a username and password. Returns the tokens to store. */
export async function signInWithPassword(args: { baseUrl: string; username: string; password: string; provider?: string }, deps: AuthDeps): Promise<OAuthAuth> {
  const f = deps.fetch ?? fetch
  const { baseUrl } = args
  const provider = args.provider ?? passwordProvider(await fetchProviders(baseUrl, f))?.name

  if (!provider) {
    throw new SignInError('unsupported', 'This server has no username and password sign-in.')
  }

  const verifier = deps.random(32)
  const challenge = await deps.sha256(verifier)
  const state = deps.random(16)

  // 1. Start. The 302 (to the /login form) carries the PKCE cookie that ties the next step to this
  // attempt. React Native follows the redirect and keeps the cookie in the platform's cookie store;
  // Node's tests read it off the 302 directly (`redirect: 'manual'`).
  const authorize = await f(`${baseUrl}/auth/native/authorize?${qs({ provider, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: REDIRECT_URI, state })}`, {
    redirect: 'manual',
    credentials: 'include',
  }).catch(error => {
    throw new SignInError('unreachable', error instanceof Error ? error.message : String(error))
  })

  if (authorize.status === 404) {
    throw new SignInError('unsupported', `The server does not know the sign-in provider "${provider}".`)
  }

  if (authorize.status >= 400) {
    throw new SignInError('server', await detail(authorize))
  }

  // 2. Credentials.
  const login = await f(`${baseUrl}/auth/password-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ provider, username: args.username, password: args.password }),
  }).catch(error => {
    throw new SignInError('unreachable', error instanceof Error ? error.message : String(error))
  })

  if (login.status === 401) {
    throw new SignInError('invalid-credentials', 'The username or password is wrong.')
  }

  if (login.status === 429) {
    throw new SignInError('rate-limited', 'Too many attempts. Wait a minute and try again.')
  }

  if (login.status === 503) {
    throw new SignInError('unreachable', 'The server’s sign-in service is unavailable.')
  }

  if (!login.ok) {
    throw new SignInError('server', await detail(login))
  }

  const { next } = (await login.json()) as { next?: string }
  // Parsed by hand: React Native's URL implementation is incomplete.
  const code = /[?&]code=([^&#]+)/.exec(next ?? '')?.[1]
  const returnedState = /[?&]state=([^&#]*)/.exec(next ?? '')?.[1]

  if (!code) {
    throw new SignInError('server', 'The server did not return a login code. Try again.')
  }

  if (returnedState !== undefined && decodeURIComponent(returnedState) !== state) {
    throw new SignInError('server', 'The login response did not match this attempt. Try again.')
  }

  // 3. Tokens.
  const token = await f(`${baseUrl}/auth/native/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code: decodeURIComponent(code), code_verifier: verifier }),
  }).catch(error => {
    throw new SignInError('unreachable', error instanceof Error ? error.message : String(error))
  })

  if (!token.ok) {
    throw new SignInError('server', await detail(token))
  }

  return { ...tokensFrom((await token.json()) as Parameters<typeof tokensFrom>[0]), user: args.username }
}

/** True when the access token has expired or will within `skewS` seconds. */
export function needsRefresh(auth: OAuthAuth, nowS: number, skewS = 120): boolean {
  return auth.expiresAt - nowS <= skewS
}

/** Rotates the tokens. A dead refresh token means the user must sign in again (`expired`). */
export async function refreshAuth(baseUrl: string, auth: OAuthAuth, fetchFn: typeof fetch = fetch, timeoutMs = 15_000): Promise<OAuthAuth> {
  // A refresh the network swallows would hold every later connect (they share one refresh): give up and let it be tried again.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const res = await fetchFn(`${baseUrl}/auth/native/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refreshToken, provider: auth.provider ?? '' }),
    signal: controller.signal,
  })
    .catch(error => {
      throw new SignInError('unreachable', controller.signal.aborted ? 'The server did not answer.' : error instanceof Error ? error.message : String(error))
    })
    .finally(() => clearTimeout(timer))

  if (res.status === 401) {
    throw new SignInError('expired', 'Your session has expired. Sign in again.')
  }

  if (res.status === 503) {
    throw new SignInError('unreachable', 'The server’s sign-in service is unavailable.')
  }

  if (!res.ok) {
    throw new SignInError('server', await detail(res))
  }

  return tokensFrom((await res.json()) as Parameters<typeof tokensFrom>[0], auth)
}
