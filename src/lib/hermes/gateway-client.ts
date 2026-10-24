/**
 * JSON-RPC 2.0 client for the Hermes `/api/ws` gateway (the protocol Hermes Desktop speaks).
 *
 * Vendored from NousResearch/hermes-agent `apps/shared/src/json-rpc-gateway.ts` (v0.21.0, MIT License,
 * Copyright (c) 2025 Nous Research). Kept close to upstream so protocol fixes are easy to port.
 * React Native changes:
 *   - URL validation uses a regex (RN's URL polyfill does not implement `.protocol`).
 *   - Abort errors are plain Errors named "AbortError" (RN has no DOMException).
 *   - DOM-only types (WebSocket/CloseEvent) are replaced with minimal structural types.
 */

export type GatewayEventName =
  | 'gateway.ready'
  | 'session.info'
  | 'session.usage'
  | 'message.start'
  | 'message.delta'
  | 'message.interim'
  | 'message.complete'
  | 'thinking.delta'
  | 'reasoning.delta'
  | 'reasoning.available'
  | 'status.update'
  | 'tool.start'
  | 'tool.progress'
  | 'tool.complete'
  | 'tool.generating'
  | 'todo.updated'
  | 'clarify.request'
  | 'approval.request'
  | 'sudo.request'
  | 'secret.request'
  | 'background.complete'
  | 'error'
  | 'skin.changed'
  | (string & {})

export interface GatewayEvent<P = unknown> {
  payload?: P
  /** Renderer-side source tag added by the Desktop gateway registry. */
  profile?: string
  /** Registry connection whose socket delivered the event (renderer-side tag;
   * absent for the local/legacy primary path). */
  connectionId?: string
  session_id?: string
  type: GatewayEventName
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
export type GatewayRequestId = number | string

export interface JsonRpcErrorPayload {
  code?: number
  data?: unknown
  message?: string
}

export interface JsonRpcFrame {
  error?: JsonRpcErrorPayload
  id?: GatewayRequestId | null
  method?: string
  params?: GatewayEvent
  result?: unknown
}

/**
 * A request FROM the server (Hermes 0.21.5+ asks approvals, questions, sudo and secrets this way): it has
 * an `id` like an answer does, but also a `method`, and wants a response frame back.
 */
export interface ServerRequestFrame {
  id: GatewayRequestId
  method: string
  params: Record<string, unknown>
}

/** JSON-RPC error with optional structured `data` from the gateway. */
export class JsonRpcGatewayError extends Error {
  readonly code?: number
  readonly data?: unknown

  constructor(message: string, options?: { code?: number; data?: unknown }) {
    super(message)
    this.name = 'JsonRpcGatewayError'
    this.code = options?.code
    this.data = options?.data
  }
}

/** Minimal structural socket type satisfied by both browser and React Native WebSocket. */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: any) => void, options?: { once?: boolean }): void
  removeEventListener(type: string, listener: (event: any) => void): void
}

export interface SocketCloseEvent {
  code: number
  reason?: string
}

const WS_OPEN = 1

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

type PendingCall = {
  reject: (error: Error) => void
  resolve: (value: unknown) => void
  timer?: ReturnType<typeof setTimeout>
}

export interface GatewayClientOptions {
  closedErrorMessage?: string
  connectErrorMessage?: string
  connectTimeoutMs?: number
  createRequestId?: (nextId: number) => GatewayRequestId
  heartbeatDeadlineMs?: number
  heartbeatIntervalMs?: number
  /** Return true to intercept the default closed-state transition. */
  onSocketClose?: (event: SocketCloseEvent) => boolean | void
  requestIdPrefix?: string
  requestTimeoutMs?: number
  socketFactory?: (url: string) => WebSocketLike
  notConnectedErrorMessage?: string
}

const ANY = '*'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
// Replay fetch after reconnect: bounded so a wedged backend can't hold the
// guard open; generous enough for a 512-frame ring to drain.
const REPLAY_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000
const DEFAULT_HEARTBEAT_DEADLINE_MS = 45_000
// A reconnect after sleep/wake must not hang forever in 'connecting' (which
// keeps the composer disabled and stuck on "Starting Hermes..."). If the open
// handshake doesn't land in this window, fail to 'error' so callers can retry.
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000

export class JsonRpcGatewayClient {
  private nextId = 0
  private pending = new Map<GatewayRequestId, PendingCall>()
  private socket: WebSocketLike | null = null
  private state: ConnectionState = 'idle'
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatSequence = 0
  private lastInboundAt = 0
  /** Last observed event seq per session_id — drives lossless reconnect replay. */
  private lastSeenSeq = new Map<string, number>()
  /** The replay fetches, one after another: each parks the frames of the sessions it replays in `replayHold`. */
  private replayChain: Promise<unknown> = Promise.resolve()
  /**
   * While a replay fetch is in flight, live seq'd frames for the sessions
   * being replayed are parked here instead of dispatching immediately.
   * Without this hold, a live frame racing the replay response is dispatched
   * twice (once live, once when the replay returns the same seq) or, worse,
   * advances the watermark so the gap events the replay carries get skipped.
   */
  private replayHold: Map<string, GatewayEvent[]> | null = null
  /**
   * Server process identity for the replay contract (from gateway.ready /
   * session.events.since). Seq counters are in-process on the backend, so a
   * restart resets them while we still hold high watermarks — without this
   * check events_since(sid, 97) returns [] + truncated=false forever and we
   * silently believe nothing was missed.
   */
  private replayEpoch: string | null = null
  private readonly eventHandlers = new Map<string, Set<(event: GatewayEvent) => void>>()
  private readonly requestHandlers = new Set<(frame: ServerRequestFrame) => void>()
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>()
  private readonly options: Required<Omit<GatewayClientOptions, 'socketFactory'>> &
    Pick<GatewayClientOptions, 'socketFactory'>

  constructor(options: GatewayClientOptions = {}) {
    this.options = {
      closedErrorMessage: options.closedErrorMessage ?? 'WebSocket closed',
      connectErrorMessage: options.connectErrorMessage ?? 'WebSocket connection failed',
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      createRequestId: options.createRequestId ?? ((nextId: number) => `${options.requestIdPrefix ?? 'r'}${nextId}`),
      heartbeatDeadlineMs: options.heartbeatDeadlineMs ?? DEFAULT_HEARTBEAT_DEADLINE_MS,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      notConnectedErrorMessage: options.notConnectedErrorMessage ?? 'gateway not connected',
      onSocketClose: options.onSocketClose ?? (() => false),
      requestIdPrefix: options.requestIdPrefix ?? 'r',
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      socketFactory: options.socketFactory
    }
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  async connect(wsUrl: string): Promise<void> {
    // Refuse garbage; WebSocket coerces non-strings into
    // `ws://<origin>/[object%20Object]` (#68250 stale-emit boot loop).
    const invalidUrl = () => {
      const got = typeof wsUrl === 'string' ? JSON.stringify(wsUrl) : `type "${typeof wsUrl}"`

      return new Error(`gateway connect() requires a ws:// or wss:// URL string, got ${got}`)
    }

    if (typeof wsUrl !== 'string') {
      throw invalidUrl()
    }

    if (!/^wss?:\/\/[^/\s]+/i.test(wsUrl)) {
      throw invalidUrl()
    }

    if (this.socket?.readyState === WS_OPEN || this.state === 'connecting') {
      return
    }

    this.setState('connecting')

    const socket: WebSocketLike = this.options.socketFactory?.(wsUrl) ?? (new WebSocket(wsUrl) as unknown as WebSocketLike)
    this.socket = socket
    this.stopHeartbeat()

    socket.addEventListener('message', message => {
      if (this.socket !== socket) {
        return
      }

      this.lastInboundAt = Date.now()
      this.handleMessage(message.data)
    })

    socket.addEventListener('close', event => {
      if (this.socket !== socket) {
        return
      }

      if (this.options.onSocketClose(event)) {
        return
      }

      this.socket = null
      this.stopHeartbeat()
      this.setState('closed')
      this.rejectAllPending(new Error(this.options.closedErrorMessage))
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimeout(timer)
        }

        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }

      const onOpen = () => {
        if (settled || this.socket !== socket) {
          return
        }

        settled = true
        cleanup()
        this.setState('open')
        resolve()
        // Lossless resume: drain events emitted while we were disconnected.
        // Fire-and-forget so connect() latency is unaffected; only runs when
        // we actually observed seq'd events before the drop.
        void this.replay()
      }

      const onError = () => {
        if (settled || this.socket !== socket) {
          return
        }

        settled = true
        cleanup()
        this.setState('error')
        reject(new Error(this.options.connectErrorMessage))
      }

      socket.addEventListener('open', onOpen, { once: true })
      socket.addEventListener('error', onError, { once: true })

      if (this.options.connectTimeoutMs > 0) {
        timer = setTimeout(() => {
          if (settled) {
            return
          }

          settled = true
          cleanup()

          // Drop the half-open socket so the next connect() starts clean
          // instead of short-circuiting on a zombie 'connecting' state.
          if (this.socket === socket) {
            try {
              socket.close()
            } catch {
              // ignore
            }

            this.socket = null
            this.setState('error')
          }

          reject(new Error(this.options.connectErrorMessage))
        }, this.options.connectTimeoutMs)
      }
    })
  }

  close(): void {
    const socket = this.socket

    if (!socket) {
      return
    }

    try {
      socket.close()
    } finally {
      this.socket = null
      this.stopHeartbeat()
      this.setState('closed')
      this.rejectAllPending(new Error(this.options.closedErrorMessage))
    }
  }

  /**
   * Invalidate the current socket generation after an ambiguous transport
   * outcome. The outer connection owner decides whether/when to reconnect.
   */
  invalidate(message = this.options.closedErrorMessage): void {
    const socket = this.socket

    if (!socket) {
      return
    }

    this.invalidateSocket(socket, new Error(message))
  }

  on<P = unknown>(type: GatewayEventName, handler: (event: GatewayEvent<P>) => void): () => void {
    let handlers = this.eventHandlers.get(type)

    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(type, handlers)
    }

    handlers.add(handler as (event: GatewayEvent) => void)

    return () => handlers?.delete(handler as (event: GatewayEvent) => void)
  }

  onAny(handler: (event: GatewayEvent) => void): () => void {
    return this.on(ANY as GatewayEventName, handler)
  }

  onEvent(handler: (event: GatewayEvent) => void): () => void {
    return this.onAny(handler)
  }

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler)
    handler(this.state)

    return () => this.stateHandlers.delete(handler)
  }

  /**
   * Listen for requests the server makes of this client. With no listener every such request is answered
   * "method not found" at once, so the server never waits on a client that cannot answer.
   */
  onServerRequest(handler: (frame: ServerRequestFrame) => void): () => void {
    this.requestHandlers.add(handler)

    return () => this.requestHandlers.delete(handler)
  }

  /** Answers a server request. False when the socket is not open (the server keeps the request open). */
  respond(id: GatewayRequestId, result: unknown): boolean {
    return this.writeFrame({ jsonrpc: '2.0', id, result })
  }

  respondError(id: GatewayRequestId, code: number, message: string): boolean {
    return this.writeFrame({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private writeFrame(frame: Record<string, unknown>): boolean {
    const socket = this.socket

    if (!socket || socket.readyState !== WS_OPEN) {
      return false
    }

    try {
      socket.send(JSON.stringify(frame))

      return true
    } catch {
      return false
    }
  }

  /** A request from the server: hand it to the listeners, or refuse it when nobody listens. */
  private handleServerRequest(frame: ServerRequestFrame): void {
    if (this.requestHandlers.size === 0) {
      this.respondError(frame.id, -32601, `${frame.method} is not supported by this client`)

      return
    }

    for (const handler of [...this.requestHandlers]) {
      handler(frame)
    }
  }

  request<T>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.options.requestTimeoutMs,
    signal?: AbortSignal
  ): Promise<T> {
    const socket = this.socket

    if (!socket || socket.readyState !== WS_OPEN) {
      return Promise.reject(new Error(this.options.notConnectedErrorMessage))
    }

    if (signal?.aborted) {
      return Promise.reject(abortError())
    }

    const id = this.options.createRequestId(++this.nextId)

    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined

      const detach = () => {
        if (onAbort && signal) {
          signal.removeEventListener('abort', onAbort)
        }
      }

      const pending: PendingCall = {
        resolve: value => {
          detach()
          resolve(value as T)
        },
        reject: error => {
          detach()
          reject(error)
        }
      }

      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            detach()
            // Include the configured timeout so a caller (or a user looking
            // at an error toast) can tell whether the default 30s window
            // fired or a per-call override — e.g. /compress opts into 120s.
            const seconds = Math.round(timeoutMs / 1000)
            reject(new Error(`request timed out after ${seconds}s: ${method}`))
          }
        }, timeoutMs)
      }

      // Abort drops the pending call immediately (no dangling resolver/timer);
      // server-side cancellation is a separate cooperative RPC where it matters.
      if (signal) {
        onAbort = () => {
          const call = this.pending.get(id)

          if (call?.timer) {
            clearTimeout(call.timer)
          }

          this.pending.delete(id)
          detach()
          reject(abortError())
        }

        signal.addEventListener('abort', onAbort, { once: true })
      }

      this.pending.set(id, pending)

      try {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params
          })
        )
      } catch (error) {
        this.clearPending(id)
        detach()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleMessage(raw: unknown): void {
    const text = typeof raw === 'string' ? raw : String(raw)
    let frame: JsonRpcFrame

    try {
      frame = JSON.parse(text) as JsonRpcFrame
    } catch {
      return
    }

    // An id alongside a method is the server asking us something, not answering one of our calls.
    // Treating it as an answer (nothing is pending under that id) silently dropped every prompt.
    if (frame.id !== undefined && frame.id !== null && typeof frame.method === 'string' && frame.method !== 'event') {
      this.handleServerRequest({ id: frame.id, method: frame.method, params: (frame.params ?? {}) as unknown as Record<string, unknown> })

      return
    }

    if (frame.id !== undefined && frame.id !== null) {
      const call = this.pending.get(frame.id)

      if (!call) {
        return
      }

      this.clearPending(frame.id)

      if (frame.error) {
        call.reject(
          new JsonRpcGatewayError(frame.error.message || 'Hermes RPC failed', {
            code: typeof frame.error.code === 'number' ? frame.error.code : undefined,
            data: frame.error.data
          })
        )
      } else {
        call.resolve(frame.result)
      }

      return
    }

    if (frame.method === 'event' && frame.params?.type) {
      if (frame.params.type === 'gateway.ready') {
        if (this.gatewayReadyAdvertisesHeartbeat(frame.params.payload)) {
          const socket = this.socket

          if (socket) {
            this.startHeartbeat(socket)
          }
        }

        const epoch = (frame.params.payload as { replay_epoch?: unknown } | undefined)?.replay_epoch

        if (typeof epoch === 'string' && epoch) {
          this.adoptReplayEpoch(epoch)
        }
      }

      const sid = frame.params.session_id
      const seqValue = (frame.params as { seq?: unknown }).seq

      if (this.replayHold && sid && typeof seqValue === 'number' && this.replayHold.has(sid)) {
        // Replay in flight for this session: park the frame; flushReplayHold
        // dispatches it after the replayed gap, gated on seq.
        this.replayHold.get(sid)?.push(frame.params)

        return
      }

      this.recordSeq(frame.params)
      this.dispatchEvent(frame.params)
    }
  }

  /**
   * Track each session's last observed event seq. Events without a seq
   * (legacy backend, session-less globals) leave the map untouched.
   */
  private recordSeq(event: GatewayEvent): void {
    const sid = event.session_id
    const seq = (event as { seq?: unknown }).seq

    if (!sid || typeof seq !== 'number' || !Number.isFinite(seq)) {
      return
    }

    const prev = this.lastSeenSeq.get(sid) ?? 0

    if (seq > prev) {
      this.lastSeenSeq.set(sid, seq)
    }
  }

  /** Test/telemetry hook: current last-seen seq map snapshot. */
  getSeqWatermarks(): Record<string, number> {
    return Object.fromEntries(this.lastSeenSeq)
  }

  /**
   * Replays what one session emitted since the last event this client saw from it, through the same seq-gated path as the
   * reconnect replay: after `session.resume` re-attached it, for anything it emitted between the reconnect and the resume.
   * True when nothing can be missing (the server's ring still reached back to our watermark); false when it did not, when this
   * client never saw a numbered event from the session, or when the request failed. Then the caller reads the session again.
   */
  async catchUp(sessionId: string): Promise<boolean> {
    if (!this.lastSeenSeq.has(sessionId)) {
      return false
    }

    return (await this.replay([sessionId])).has(sessionId)
  }

  /**
   * Follows a session from the server's latest event on, so a later reconnect replays exactly what this client missed of it.
   * For a session whose history was just read whole: everything before now is already shown, and what comes next arrives live.
   * Best-effort: without a watermark a reconnect cannot catch up, and the caller reads the session again instead.
   */
  async follow(sessionId: string): Promise<void> {
    try {
      const result = await this.request<{ latest_seq?: number; epoch?: string }>(
        'session.events.since',
        { session_id: sessionId, last_seen: Number.MAX_SAFE_INTEGER },
        REPLAY_REQUEST_TIMEOUT_MS
      )

      if (typeof result?.epoch === 'string' && result.epoch) {
        this.adoptReplayEpoch(result.epoch)
      }

      const latest = result?.latest_seq

      if (typeof latest === 'number' && Number.isFinite(latest) && latest > (this.lastSeenSeq.get(sessionId) ?? 0)) {
        this.lastSeenSeq.set(sessionId, latest)
      }
    } catch {
      // See above.
    }
  }

  /** Runs a replay fetch after the ones before it (each holds its sessions' live frames in `replayHold` while it runs). */
  private replay(only?: readonly string[]): Promise<Set<string>> {
    const run = this.replayChain.then(() => this.fetchReplay(only))
    this.replayChain = run.catch(() => undefined)

    return run
  }

  /**
   * After a reconnect, ask the gateway to replay every event newer than our
   * per-session watermarks (or only `only`'s). Replayed frames go through the
   * SAME dispatchEvent path as live frames — dedupe happens naturally because
   * recordSeq ignores non-increasing seqs and downstream stores key on event
   * identity. Returns the sessions replayed completely (not truncated).
   * Best-effort: failures are swallowed (the next reconnect retries).
   */
  private async fetchReplay(only?: readonly string[]): Promise<Set<string>> {
    const complete = new Set<string>()
    const sids = (only ?? [...this.lastSeenSeq.keys()]).filter(sid => this.lastSeenSeq.has(sid))

    if (sids.length === 0) {
      return complete
    }

    // Park live frames for the sessions we're about to replay so a frame
    // racing the replay response can't dispatch ahead of (or duplicate) the
    // gap events. Sessions without watermarks are unaffected.
    const hold = new Map<string, GatewayEvent[]>()

    for (const sid of sids) {
      hold.set(sid, [])
    }

    this.replayHold = hold

    try {
      // One RPC per known session keeps params flat; sessions are few (<20).
      const results = await Promise.allSettled(
        sids.map(sid =>
          this.request<{ events?: { type: string; session_id?: string; seq?: number; payload?: unknown }[]; truncated?: boolean }>(
            'session.events.since',
            { session_id: sid, last_seen: this.lastSeenSeq.get(sid) ?? 0 },
            REPLAY_REQUEST_TIMEOUT_MS
          )
        )
      )

      for (const [index, result] of results.entries()) {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value?.events)) {
          continue
        }

        const epoch = (result.value as { epoch?: unknown }).epoch

        if (typeof epoch === 'string' && epoch && this.replayEpoch && epoch !== this.replayEpoch) {
          // Backend restarted: its seq numbering reset, so our watermarks —
          // and this replay window — are meaningless. Drop them and start
          // fresh under the new epoch.
          this.adoptReplayEpoch(epoch)

          continue
        }

        if (typeof epoch === 'string' && epoch && !this.replayEpoch) {
          this.replayEpoch = epoch
        }

        for (const event of result.value.events) {
          if (!event?.type) {
            continue
          }

          this.dispatchIfNewer(event as GatewayEvent)
        }

        // Requests still waiting on this client when it dropped: hand them over as if they had just arrived.
        for (const open of (result.value as { open_requests?: unknown }).open_requests as ServerRequestFrame[] | undefined ?? []) {
          if (open && typeof open.method === 'string' && open.id !== undefined) {
            this.handleServerRequest({ id: open.id, method: open.method, params: open.params ?? {} })
          }
        }

        // A truncated window lost events past the server's ring: the replay has holes.
        if (result.value.truncated !== true) {
          complete.add(sids[index] as string)
        }
      }
    } catch {
      // Replay is an optimization over lossy-reconnect; never surface errors.
    } finally {
      this.flushReplayHold()
    }

    return complete
  }

  /**
   * Dispatch an event only when its seq advances the session watermark.
   * Seq-less events always dispatch (no ordering contract to violate).
   */
  private dispatchIfNewer(event: GatewayEvent): void {
    const sid = event.session_id
    const seq = (event as { seq?: unknown }).seq

    if (sid && typeof seq === 'number' && Number.isFinite(seq)) {
      const prev = this.lastSeenSeq.get(sid) ?? 0

      if (seq <= prev) {
        return
      }

      this.lastSeenSeq.set(sid, seq)
    }

    this.dispatchEvent(event)
  }

  /**
   * Record the server's replay epoch; on change (backend restart) the old
   * seq watermarks describe a numbering that no longer exists — clear them
   * so the next reconnect doesn't silently believe it missed nothing.
   */
  private adoptReplayEpoch(epoch: string): void {
    if (this.replayEpoch === epoch) {
      return
    }

    if (this.replayEpoch !== null) {
      this.lastSeenSeq.clear()
    }

    this.replayEpoch = epoch
  }

  /** Release frames parked during a replay fetch, seq-gated against dupes. */
  private flushReplayHold(): void {
    const hold = this.replayHold
    this.replayHold = null

    if (!hold) {
      return
    }

    for (const parked of hold.values()) {
      for (const event of parked) {
        this.dispatchIfNewer(event)
      }
    }
  }

  private gatewayReadyAdvertisesHeartbeat(payload: unknown): boolean {
    return Boolean(payload && typeof payload === 'object' && (payload as { heartbeat?: unknown }).heartbeat === true)
  }

  private startHeartbeat(socket: WebSocketLike): void {
    this.stopHeartbeat()
    this.lastInboundAt = Date.now()

    if (this.options.heartbeatIntervalMs <= 0 || this.options.heartbeatDeadlineMs <= 0) {
      return
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WS_OPEN) {
        return
      }

      if (Date.now() - this.lastInboundAt >= this.options.heartbeatDeadlineMs) {
        this.invalidateSocket(socket, new Error('WebSocket heartbeat acknowledgement timed out'))

        return
      }

      try {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: `heartbeat-${++this.heartbeatSequence}`,
            method: 'gateway.ping',
            params: {}
          })
        )
      } catch (error) {
        this.invalidateSocket(socket, error instanceof Error ? error : new Error(String(error)))
      }
    }, this.options.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private invalidateSocket(socket: WebSocketLike, error: Error): void {
    if (this.socket !== socket) {
      return
    }

    this.socket = null
    this.stopHeartbeat()

    try {
      socket.close()
    } catch {
      // The generation was already invalidated; the reconnect owner can redial.
    }

    this.setState('closed')
    this.rejectAllPending(error)
  }

  private clearPending(id: GatewayRequestId): void {
    const call = this.pending.get(id)

    if (call?.timer) {
      clearTimeout(call.timer)
    }

    this.pending.delete(id)
  }

  private dispatchEvent(event: GatewayEvent): void {
    for (const handler of this.eventHandlers.get(event.type) ?? []) {
      handler(event)
    }

    for (const handler of this.eventHandlers.get(ANY) ?? []) {
      handler(event)
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, call] of this.pending) {
      if (call.timer) {
        clearTimeout(call.timer)
      }

      call.reject(error)
      this.pending.delete(id)
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return
    }

    this.state = state

    for (const handler of this.stateHandlers) {
      handler(state)
    }
  }
}
