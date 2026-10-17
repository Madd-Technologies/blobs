/**
 * Where a bot's commands run ("Runs on"): this computer, a container on it, or another computer over SSH.
 *
 * Hermes reads it from the bot's own `terminal` section (defaults ← `.env` ← `config.yaml`, the last one wins), so the app
 * reads `GET /api/config?profile=` and writes `PUT /api/config?profile=` as it does for approvals. A cloud sandbox (Modal,
 * Daytona, Vercel, Singularity) needs keys on the server, so it is only shown. The SSH key is made on the server by
 * hermes-bot-mobile 0.1.4+ (`/runs-on/key`), which also checks a connection the way Hermes's SSH backend connects
 * (`/runs-on/check`): the private key never reaches the phone.
 */

import { HermesHttpError, restJson, type ServerConfig } from './server.ts'

const qs = (profile: string) => `?profile=${encodeURIComponent(profile)}`

export type RunsOnKind = 'local' | 'docker' | 'ssh' | 'other'

export interface SshTarget {
  host: string
  user: string
  port: number
  /** The private key's full path on the server; empty lets ssh use its own defaults, as Hermes does. */
  key: string
}

export interface RunsOn extends SshTarget {
  kind: RunsOnKind
  /** Hermes's own name for it (`ssh`, or `modal` for a cloud sandbox). */
  backend: string
  /** The bot's working folder as configured (empty when unset). */
  cwd: string
  /**
   * SSH whose address is not in `config.yaml`: Hermes's own setup keeps it in the bot's `.env` (`TERMINAL_SSH_*`), which
   * the app cannot read in full. Shown, never written back blank.
   */
  fromServer: boolean
  /** For `fromServer`: `user@host` as the server's backends route reports it, when it does. */
  serverTarget?: string
}

export const RUNS_ON_CHOICES: { kind: Exclude<RunsOnKind, 'other'>; label: string }[] = [
  { kind: 'local', label: 'This computer' },
  { kind: 'docker', label: 'A container on this computer' },
  { kind: 'ssh', label: 'Another computer' },
]

const SANDBOXES: Record<string, string> = { modal: 'Modal', daytona: 'Daytona', vercel_sandbox: 'Vercel Sandbox', singularity: 'Singularity' }

const text = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')

/** Where a bot's commands run, from its config (`GET /api/config?profile=`). Anything unreadable reads as this computer. */
export function runsOnOf(config: Record<string, unknown> | null | undefined): RunsOn {
  const terminal = (config?.terminal && typeof config.terminal === 'object' ? config.terminal : {}) as Record<string, unknown>
  const backend = text(terminal.backend).toLowerCase() || 'local'
  const kind: RunsOnKind = backend === 'local' || backend === 'docker' || backend === 'ssh' ? backend : 'other'
  const port = Number(text(terminal.ssh_port))

  const host = text(terminal.ssh_host)

  return {
    kind,
    backend,
    host,
    user: text(terminal.ssh_user),
    port: Number.isInteger(port) && port > 0 ? port : 22,
    key: text(terminal.ssh_key),
    cwd: text(terminal.cwd),
    fromServer: kind === 'ssh' && !host,
  }
}

/** The Details row's value: "This computer", "A container", "vps-1 over SSH", "Modal". */
export function runsOnLabel(runsOn: RunsOn): string {
  switch (runsOn.kind) {
    case 'local':
      return 'This computer'
    case 'docker':
      return 'A container'
    case 'ssh': {
      const host = runsOn.host || runsOn.serverTarget?.split('@').pop()

      return host ? `${host} over SSH` : 'Another computer'
    }
    default:
      return SANDBOXES[runsOn.backend] ?? runsOn.backend
  }
}

/**
 * The config change that moves a bot to `kind`. Moving onto SSH also points a working folder that names a path on this
 * computer at the other computer's home (`~`), where that path would not exist; anything else keeps its folder.
 */
export function runsOnChange(current: RunsOn, kind: Exclude<RunsOnKind, 'other'>, target?: SshTarget): { terminal: Record<string, unknown> } {
  if (kind !== 'ssh') {
    return { terminal: { backend: kind } }
  }

  if (!target) {
    throw new Error('Another computer needs its address and user.')
  }

  const terminal: Record<string, unknown> = { backend: 'ssh', ssh_host: target.host.trim(), ssh_user: target.user.trim(), ssh_port: target.port }

  // A blank key is left out rather than written: written, it would hide a key the server's `.env` names.
  if (target.key.trim()) {
    terminal.ssh_key = target.key.trim()
  }

  if (current.kind !== 'ssh' && current.cwd && !current.cwd.startsWith('~') && !['.', 'auto', 'cwd'].includes(current.cwd)) {
    terminal.cwd = '~'
  }

  return { terminal }
}

// The same rules the plugin checks (`runs_on.py`), so the form says what is wrong before anything is sent.
const HOST = /^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,252}|[0-9A-Fa-f:]{2,39})$/
const USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/

/** What is wrong with an SSH target, in words for the form, or null. */
export function targetProblem(target: Pick<SshTarget, 'host' | 'user' | 'port'>): string | null {
  const host = target.host.trim().replace(/^\[|\]$/g, '')

  if (!host) {
    return 'Enter the computer’s address.'
  }

  if (!HOST.test(host) || host.includes('..')) {
    return 'That address has characters an address can’t have.'
  }

  if (!target.user.trim()) {
    return 'Enter the user to sign in as.'
  }

  if (!USER.test(target.user.trim())) {
    return 'That isn’t a user name: letters, numbers, ., - and _.'
  }

  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    return 'A port is a number from 1 to 65535.'
  }

  return null
}

/** "scout@vps-1.example.net:2222" pasted into Address: the parts it names (an IPv6 address keeps its colons). */
export function splitAddress(input: string): { host: string; user?: string; port?: number } {
  let rest = input.trim().replace(/^ssh:\/\//, '')
  let user: string | undefined
  let port: number | undefined
  const at = rest.lastIndexOf('@')

  if (at > 0) {
    user = rest.slice(0, at)
    rest = rest.slice(at + 1)
  }

  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest)
  const hostPort = /^([^:]+):(\d+)$/.exec(rest)

  if (bracketed) {
    rest = bracketed[1] ?? rest
    port = bracketed[2] ? Number(bracketed[2]) : undefined
  } else if (hostPort) {
    rest = hostPort[1] ?? rest
    port = Number(hostPort[2])
  }

  return { host: rest, ...(user ? { user } : {}), ...(port ? { port } : {}) }
}

// ── the server ─────────────────────────────────────────────────────────────────────────────────

/**
 * `user@host` of a bot whose SSH address is in its `.env`, from the dashboard's backends route (Hermes 0.21.6+; its SSH
 * row reads `terminal.*`, then `TERMINAL_SSH_*`). Undefined when the server does not say.
 */
export async function sshOnServer(config: ServerConfig, profile: string): Promise<string | undefined> {
  try {
    const { backends } = await restJson<{ backends?: { name: string; status: string; detail?: string }[] }>(config, `/api/tools/terminal/backends${qs(profile)}`)
    const ssh = backends?.find(row => row.name === 'ssh')

    return ssh?.status === 'ready' && ssh.detail && /^[^@\s]+@[^@\s]+$/.test(ssh.detail) ? ssh.detail : undefined
  } catch {
    return undefined
  }
}

const PLUGIN = '/api/plugins/hermes-bot-mobile/runs-on'

export interface RunsOnKey {
  /** `ssh-ed25519 AAAA… blobs-<profile>`, or null before one is made. */
  public: string | null
  /** Where the private key is on the server (for `ssh_key`). */
  path: string
}

/** The bot's key on the server, or null when its hermes-bot-mobile is older than 0.1.4 (or not there). */
export async function runsOnKey(config: ServerConfig, profile: string): Promise<RunsOnKey | null> {
  try {
    return await restJson<RunsOnKey>(config, `${PLUGIN}/key${qs(profile)}`)
  } catch (error) {
    if (error instanceof HermesHttpError && error.status === 404 && !error.message.includes('No bot called')) {
      return null
    }

    throw error
  }
}

/** Makes the bot's key pair on the server if it has none. */
export function makeRunsOnKey(config: ServerConfig, profile: string): Promise<RunsOnKey & { public: string; created: boolean }> {
  return restJson(config, `${PLUGIN}/key`, { method: 'POST', body: JSON.stringify({ profile }) })
}

export type RunsOnCheck = { ok: true; system: string } | { ok: false; reason: string; detail?: string }

/** Connects the way the bot will (ssh), or asks Docker whether it is running. */
export function checkRunsOn(config: ServerConfig, profile: string, backend: 'ssh' | 'docker', target?: SshTarget): Promise<RunsOnCheck> {
  const body = { profile, backend, ...(target ? { host: target.host.trim(), user: target.user.trim(), port: target.port, key: target.key } : {}) }

  return restJson(config, `${PLUGIN}/check`, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 40_000 })
}

/** The plugin's own words for a refused request (`{"detail": "…"}`), instead of the raw status line. */
export function detailOf(error: unknown): string | null {
  if (!(error instanceof HermesHttpError)) {
    return null
  }

  const json = error.message.slice(error.message.indexOf('{'))

  try {
    const detail = (JSON.parse(json) as { detail?: unknown }).detail

    return typeof detail === 'string' ? detail : null
  } catch {
    return null
  }
}

/** What a check found, in a line under the form. */
export function checkLine(check: RunsOnCheck, target: Pick<SshTarget, 'host' | 'user' | 'port'>): string {
  if (check.ok) {
    return `Connected · ${check.system}`
  }

  const host = target.host.trim() || 'That computer'

  switch (check.reason) {
    case 'auth':
      return `${host} didn’t accept the key. Add it to ~/.ssh/authorized_keys for ${target.user.trim() || 'that user'} there.`
    case 'too_many_keys':
      return `The server’s ssh offered its other keys first and ${host} stopped before this one. Raise MaxAuthTries there, or give the server fewer keys.`
    case 'host_key':
      return `${host} isn’t the computer the server met before at that address. If you rebuilt it, remove its line from ~/.ssh/known_hosts on the server.`
    case 'unknown_host':
      return `The server can’t find ${host}. Check the address.`
    case 'refused':
      return `${host} refused the connection on port ${target.port}. Check that SSH is running there.`
    case 'timeout':
      return `No answer from ${host}. Check the address, the port and its firewall.`
    case 'unreachable':
      return `The server can’t reach ${host} from its network.`
    case 'key_missing':
      return 'There’s no key file at that path on the server.'
    case 'no_ssh':
      return 'ssh isn’t installed on the server.'
    case 'no_docker':
      return 'Docker isn’t installed on the server.'
    case 'docker_down':
      return 'Docker is installed on the server but isn’t running.'
    default:
      return check.detail ? `Couldn’t connect: ${check.detail}` : `Couldn’t connect to ${host}.`
  }
}
