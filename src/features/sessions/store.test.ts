import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { JsonRpcGatewayError, type GatewayEvent } from '../../lib/hermes/gateway-client.ts'
import type { ProfileRow, SessionResumeResult } from '../../lib/hermes/protocol.ts'
import type { MessagesPage, SessionsPage, StoredMessage } from '../../lib/hermes/rest.ts'
import type { RequestBridge } from '../../lib/hermes/server-requests.ts'
import { HermesHttpError, type ServerConfig } from '../../lib/hermes/server.ts'
import { pendingPrompts } from '../transcript/reduce.ts'
import type { QueueTimers } from './queue.ts'
import { createSessions, PAGE_SIZE, type Sessions } from './store.ts'

const dir = new URL('../../../docs/protocol-captures/', import.meta.url)
const config: ServerConfig = { baseUrl: 'http://x', auth: { kind: 'token', token: 't' } }
const history = JSON.parse(readFileSync(new URL('messages.json', dir), 'utf8')) as MessagesPage

function capture(name: string, liveId: string): GatewayEvent[] {
  return readFileSync(new URL(`${name}.jsonl`, dir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { kind: string; event?: GatewayEvent })
    .flatMap(line => (line.kind === 'event' && line.event ? [{ ...line.event, session_id: liveId }] : []))
}

function rpcError(code: number, message = 'err') {
  return new JsonRpcGatewayError(message, { code })
}

const row = (name: string, canonical?: string): ProfileRow =>
  ({ name, canonical_session: canonical ? { id: canonical, resolved_id: canonical } : null, ui_meta_revisions: {} }) as unknown as ProfileRow

/** Timers the test steps by hand. */
function manualTimers() {
  const tasks = new Map<number, () => void>()
  let next = 1
  const timers: QueueTimers = {
    set: fn => {
      tasks.set(next, fn)
      return next++
    },
    clear: handle => void tasks.delete(handle as number),
  }

  const runAll = () => {
    const due = [...tasks.values()]
    tasks.clear()
    due.forEach(fn => fn())
  }

  return { timers, pending: () => tasks.size, runAll }
}

interface Harness {
  sessions: Sessions
  calls: { method: string; params: Record<string, unknown> }[]
  emit: (event: GatewayEvent) => void
  handlers: Record<string, (params: Record<string, unknown>) => unknown>
  timers: ReturnType<typeof manualTimers>
  setRoster: (rows: ProfileRow[]) => void
  setPage: (pages: (offset: number) => StoredMessage[]) => void
  /** What the server's paged list of stored chats answers (REST, so not in `calls`). */
  setChats: (page: (query: { offset: number; limit: number; excludeSources?: string[] }) => SessionsPage) => void
  chatQueries: { offset: number; limit: number; excludeSources?: string[] }[]
  nextLive: { value: number }
}

function harness(requests?: Pick<RequestBridge, 'answer' | 'ingest'>, live: { liveWork?: boolean; liveHelpers?: boolean } = {}): Harness {
  const calls: Harness['calls'] = []
  const listeners = new Set<(event: GatewayEvent) => void>()
  const timers = manualTimers()
  let roster: ProfileRow[] = [row('bot', 'stored-1')]
  let pages: (offset: number) => StoredMessage[] = () => history.messages
  let chats: (query: { offset: number; limit: number; excludeSources?: string[] }) => SessionsPage = () => ({ sessions: [], total: 0 })
  const chatQueries: Harness['chatQueries'] = []
  const nextLive = { value: 1 }

  const handlers: Harness['handlers'] = {
    'session.resume': () =>
      ({ session_id: `live-${nextLive.value++}`, session_key: 'stored-1', running: false, inflight: null, info: { model: 'm', provider: 'p' } }) satisfies Partial<SessionResumeResult>,
    'prompt.submit': () => ({ status: 'streaming' }),
    'session.interrupt': () => ({ status: 'interrupted' }),
    'approval.respond': () => ({ resolved: 1 }),
    'clarify.respond': () => ({ status: 'ok' }),
  }

  const client = {
    async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params })
      const handler = handlers[method]

      if (!handler) {
        throw new Error(`unscripted ${method}`)
      }

      return (await handler(params)) as T
    },
  }

  const sessions = createSessions({
    client,
    getConfig: () => config,
    getRosterRow: profile => roster.find(entry => entry.name === profile),
    onEvent: handler => {
      listeners.add(handler)
      return () => void listeners.delete(handler)
    },
    listMessages: async (_config, _id, _profile, query) => {
      const messages = pages(query?.offset ?? 0)
      return { session_id: 'stored-1', messages, pagination: { limit: PAGE_SIZE, offset: query?.offset ?? 0, order: 'latest', returned: messages.length } }
    },
    listSessions: async (_config, { offset, limit, excludeSources }) => {
      chatQueries.push({ offset, limit, excludeSources })
      return chats({ offset, limit, excludeSources })
    },
    requests,
    readBase64: async uri => (uri.includes('missing') ? Promise.reject(new Error('Could not read that file.')) : Buffer.from(uri).toString('base64')),
    now: () => 1_000,
    timers: timers.timers,
    sleep: async () => undefined,
    liveWork: () => !!live.liveWork,
    liveHelpers: () => !!live.liveHelpers,
  })

  return {
    sessions,
    calls,
    emit: event => listeners.forEach(listener => listener(event)),
    handlers,
    timers,
    setRoster: rows => void (roster = rows),
    setPage: fn => void (pages = fn),
    setChats: fn => void (chats = fn),
    chatQueries,
    nextLive,
  }
}

const bot = (h: Harness, profile = 'bot') => h.sessions.store.getState().bots[profile]
const methods = (h: Harness) => h.calls.map(call => call.method)

describe('open', () => {
  it('reads the history while the server resumes the chat, not after it', async () => {
    const h = harness()
    let readBeforeResumed = false
    let release: () => void = () => undefined
    const resumed = h.handlers['session.resume'] as (params: Record<string, unknown>) => unknown
    h.handlers['session.resume'] = params => new Promise(resolve => (release = () => resolve(resumed(params))))
    h.setPage(() => {
      readBeforeResumed = true
      return []
    })
    const opening = h.sessions.open('bot')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(readBeforeResumed, true, 'the history read started before session.resume answered')
    release()
    await opening
    assert.equal(bot(h)?.phase, 'ready')
  })

  it('resumes the canonical Bot Chat, loads history and registers the live id', async () => {
    const h = harness()
    await h.sessions.open('bot')

    assert.deepEqual(methods(h), ['session.resume'])
    assert.deepEqual(h.calls[0]?.params, { session_id: 'stored-1', profile: 'bot', omit_messages: true, defer_history: true })
    assert.equal(bot(h)?.phase, 'ready')
    assert.equal(bot(h)?.liveId, 'live-1')
    assert.equal(bot(h)?.storedId, 'stored-1')
    assert.equal(bot(h)?.transcript.items[0]?.kind, 'user')
    assert.equal(bot(h)?.hasOlder, false)
    assert.deepEqual(h.sessions.knownLiveIds(), { bot: ['live-1'] })
  })

  it('finds an existing Bot Chat by title when the roster has no canonical session', async () => {
    const h = harness()
    h.setRoster([row('bot')])
    h.handlers['session.list'] = () => ({ sessions: [{ id: 'old', resolved_id: 'stored-1', title: 'Bot Chat' }] })
    await h.sessions.open('bot')
    assert.deepEqual(methods(h), ['session.list', 'session.resume'])
    assert.equal(h.calls[0]?.params.title, 'Bot Chat')
    assert.equal(h.calls[0]?.params.include_hidden, true)
    assert.equal(bot(h)?.storedId, 'stored-1', 'prefers resolved_id')
  })

  it('creates and titles a hidden Bot Chat that follows the profile config when none exists', async () => {
    const h = harness()
    h.setRoster([row('bot')])
    h.handlers['session.list'] = () => ({ sessions: [] })
    h.handlers['session.create'] = () => ({ session_id: 'live-new', stored_session_id: 'stored-1', info: {} })
    h.handlers['session.title'] = () => ({})
    await h.sessions.open('bot')
    assert.deepEqual(methods(h), ['session.list', 'session.create', 'session.title', 'session.resume'])
    assert.deepEqual(h.calls[1]?.params, { profile: 'bot', title: 'Bot Chat', hidden: true, follow_profile_config: true })
    assert.deepEqual(h.calls[2]?.params, { session_id: 'live-new', title: 'Bot Chat' })
  })

  it('recreates Bot Chat once when the stored session is gone (4007)', async () => {
    const h = harness()
    let first = true
    h.handlers['session.resume'] = params => {
      if (first) {
        first = false
        throw rpcError(4007)
      }
      return { session_id: 'live-9', session_key: String(params.session_id), running: false }
    }
    h.handlers['session.create'] = () => ({ session_id: 'live-new', stored_session_id: 'stored-NEW', info: {} })
    h.handlers['session.title'] = () => ({})
    await h.sessions.open('bot')
    assert.equal(bot(h)?.phase, 'ready')
    assert.equal(bot(h)?.storedId, 'stored-NEW')
    assert.deepEqual(methods(h), ['session.resume', 'session.create', 'session.title', 'session.resume'])
  })

  it('retries a settling session (4009) with backoff, then succeeds', async () => {
    const h = harness()
    let tries = 0
    h.handlers['session.resume'] = () => {
      if (++tries < 3) {
        throw rpcError(4009)
      }
      return { session_id: 'live-1', session_key: 'stored-1', running: false }
    }
    await h.sessions.open('bot')
    assert.equal(tries, 3)
    assert.equal(bot(h)?.phase, 'ready')
  })

  it('gives up on a session that never settles', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => {
      throw rpcError(4009, 'settling')
    }
    await h.sessions.open('bot')
    assert.equal(bot(h)?.phase, 'error')
    assert.equal(h.calls.filter(call => call.method === 'session.resume').length, 4)
  })

  it('explains a refused resume (4090) in plain words', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => {
      throw rpcError(4090)
    }
    await h.sessions.open('bot')
    assert.equal(bot(h)?.phase, 'error')
    assert.match(bot(h)?.error ?? '', /another device/)
  })

  it('concurrent opens share one run', async () => {
    const h = harness()
    await Promise.all([h.sessions.open('bot'), h.sessions.open('bot'), h.sessions.open('bot')])
    assert.equal(h.calls.filter(call => call.method === 'session.resume').length, 1)
  })
})

describe('work that outlives the turn, when a chat opens', () => {
  const settled = () => new Promise(resolve => setImmediate(resolve))

  it('a server that reports only helpers (0.21.5) is asked for the chat’s helpers, not its processes', async () => {
    const h = harness(undefined, { liveHelpers: true })
    h.handlers['subagent.list'] = () => ({ subagents: [{ subagent_id: 'sa-0', goal: 'Write the release notes', delegation_id: 'deleg_1', started_at: 0.5 }] })
    await h.sessions.open('bot')
    await settled()

    assert.deepEqual(methods(h), ['session.resume', 'subagent.list'])
    assert.equal(bot(h)?.transcript.liveHelpers, true)
    assert.equal(bot(h)?.transcript.liveWork, undefined)
    assert.equal(bot(h)?.transcript.jobs?.deleg_1?.kind, 'helpers')
  })

  it('a server with live work (0.22) is asked for both', async () => {
    const h = harness(undefined, { liveWork: true, liveHelpers: true })
    h.handlers['process.list'] = () => ({ processes: [] })
    h.handlers['subagent.list'] = () => ({ subagents: [] })
    await h.sessions.open('bot')
    await settled()

    assert.deepEqual(methods(h).slice(1).sort(), ['process.list', 'subagent.list'])
    assert.equal(bot(h)?.transcript.liveWork, true)
  })
})

describe('resuming a running or blocked session', () => {
  it('continues the reply being typed and restores a pending approval', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => ({
      session_id: 'live-1',
      session_key: 'stored-1',
      running: true,
      inflight: { assistant: 'Working on it', streaming: true, user: 'do it' },
      pending_approval: { command: 'rm -r /x', description: 'delete', request_id: 'r1' },
    })
    await h.sessions.open('bot')
    const transcript = bot(h)?.transcript
    assert.equal(transcript?.running, true)
    // The bubble is closed because a prompt follows the text.
    assert.equal(transcript?.items.some(item => item.kind === 'assistant' && !item.streaming && item.text === 'Working on it'), true)
    assert.deepEqual(pendingPrompts(transcript!).map(item => item.kind), ['approval'])
  })

  it('does not repeat a reply that history already holds (a tool call is in flight)', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => ({
      session_id: 'live-1',
      session_key: 'stored-1',
      running: true,
      inflight: { assistant: 'Running that now.', streaming: true },
      pending_approval: { command: 'rm -r /x', description: 'delete', request_id: 'r1' },
    })
    h.setPage(() => [
      { id: 1, role: 'user', content: 'Run it' },
      { id: 2, role: 'assistant', content: 'Running that now.', tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"rm -r /x"}' } }] },
    ])
    await h.sessions.open('bot')
    const bubbles = bot(h)!.transcript.items.filter(item => item.kind === 'assistant')
    assert.equal(bubbles.length, 1)
    assert.deepEqual(bot(h)!.transcript.items.map(item => item.kind), ['user', 'assistant', 'activity', 'approval'])
  })

  it('shows nothing of a running turn another bot started (Juniper’s chat, opened while Orion’s message is being answered)', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => ({
      session_id: 'live-1',
      session_key: 'stored-1',
      running: true,
      inflight: { assistant: 'Ping received. Relaying to Orion', streaming: true, user: 'Message from 🤖 Orion (@hermes): Alex asked for a test.' },
    })
    h.setPage(() => [
      { id: 1, role: 'user', content: 'Another' },
      { id: 2, role: 'assistant', content: 'Sent.' },
    ])
    await h.sessions.open('bot')
    const transcript = bot(h)!.transcript
    // The partial reply is not added, and anything the turn adds from here on is chatter.
    assert.deepEqual(transcript.items.map(item => item.kind), ['user', 'assistant'])
    assert.equal(transcript.chatterFrom, 2)
    assert.equal(transcript.running, true)
  })

  it('shows nothing of a routine’s turn that is running when the chat opens, then only its summary when it ends', async () => {
    const h = harness()
    const delivery = '[Cronjob "nightly" output — scheduled job, not the user. Review it, act on anything that needs action, and summarize for the chat.]\n\nraw job output'
    h.handlers['session.resume'] = () => ({ session_id: 'live-1', session_key: 'stored-1', running: true, inflight: { assistant: 'Checking the run first', streaming: true, user: delivery } })
    h.setPage(() => [
      { id: 1, role: 'user', content: 'hi' },
      { id: 2, role: 'assistant', content: 'hello' },
      { id: 3, role: 'user', content: delivery },
      { id: 4, role: 'assistant', content: 'A completion notice. Before I relay it, I will verify.' },
    ])
    await h.sessions.open('bot')

    const visible = () => {
      const transcript = bot(h)!.transcript
      return transcript.items.filter((item, index) => !item.chatter && (transcript.chatterFrom == null || index < transcript.chatterFrom)).map(item => (item.kind === 'assistant' || item.kind === 'note' ? `${item.kind}:${item.text}` : item.kind))
    }

    assert.deepEqual(visible(), ['user', 'assistant:hello', 'note:Routine “Nightly” ran'])

    h.emit({ type: 'message.delta', session_id: 'live-1', payload: { text: 'Nightly ran clean: nothing needs you.' } })
    h.timers.runAll()
    assert.deepEqual(visible(), ['user', 'assistant:hello', 'note:Routine “Nightly” ran'], 'still working: nothing shows')

    h.emit({ type: 'message.complete', session_id: 'live-1', payload: { text: 'Nightly ran clean: nothing needs you.', status: 'complete' } })
    h.timers.runAll()
    assert.deepEqual(visible(), ['user', 'assistant:hello', 'note:Routine “Nightly” ran', 'assistant:Nightly ran clean: nothing needs you.'])
  })

  it('still shows a running turn that you started', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => ({ session_id: 'live-1', session_key: 'stored-1', running: true, inflight: { assistant: 'Working on it', streaming: true, user: 'do it' } })
    h.setPage(() => [{ id: 1, role: 'user', content: 'do it' }])
    await h.sessions.open('bot')
    const transcript = bot(h)!.transcript
    assert.equal(transcript.chatterFrom, null)
    assert.equal(transcript.items.some(item => item.kind === 'assistant' && item.text === 'Working on it'), true)
  })

  it('still continues a reply that has not reached history yet', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => ({ session_id: 'live-1', session_key: 'stored-1', running: true, inflight: { assistant: 'Typing this now', streaming: true } })
    h.setPage(() => [
      { id: 1, role: 'user', content: 'Tell me something' },
      { id: 2, role: 'assistant', content: 'An earlier answer' },
      { id: 3, role: 'user', content: 'Another question' },
    ])
    await h.sessions.open('bot')
    const last = bot(h)!.transcript.items.at(-1)
    assert.deepEqual([last?.kind, last?.kind === 'assistant' && last.text, last?.kind === 'assistant' && last.streaming], ['assistant', 'Typing this now', true])
  })

  it('keeps typing into the same bubble when a reply is still streaming', async () => {
    const h = harness()
    h.handlers['session.resume'] = () => ({ session_id: 'live-1', session_key: 'stored-1', running: true, inflight: { assistant: 'Hello ', streaming: true } })
    h.setPage(() => [])
    await h.sessions.open('bot')
    h.emit({ type: 'message.delta', session_id: 'live-1', payload: { text: 'there' } })
    h.timers.runAll()
    const bubbles = bot(h)!.transcript.items.filter(item => item.kind === 'assistant')
    assert.equal(bubbles.length, 1)
    assert.deepEqual([bubbles[0]?.kind === 'assistant' && bubbles[0].text, bubbles[0]?.kind === 'assistant' && bubbles[0].streaming], ['Hello there', true])
  })

  it('shows the last failure only if that turn never got a reply', async () => {
    const h = harness()
    const inflight = { status: 'error', error: 'HTTP 500: boom', recoverable: true }
    h.handlers['session.resume'] = () => ({ session_id: 'live-1', session_key: 'stored-1', running: false, inflight })

    h.setPage(() => [{ id: 1, role: 'user', content: 'hello' }])
    await h.sessions.open('bot')
    assert.equal(bot(h)?.transcript.items.at(-1)?.kind, 'error')

    h.setPage(() => [{ id: 1, role: 'user', content: 'hello' }, { id: 2, role: 'assistant', content: 'hi' }])
    await h.sessions.open('bot', { silent: true })
    assert.equal(bot(h)?.transcript.items.some(item => item.kind === 'error'), false, 'an old failure is not replayed')
  })
})

describe('streaming a turn', () => {
  it('shows the user message at once and sends it to the live id', async () => {
    const h = harness()
    await h.sessions.open('bot')
    const before = bot(h)!.transcript.items.length
    await h.sessions.send('bot', '  Say hi  ')
    assert.deepEqual(h.calls.at(-1), { method: 'prompt.submit', params: { session_id: 'live-1', text: 'Say hi' } })
    const user = bot(h)!.transcript.items[before]
    assert.deepEqual([user?.kind, user?.kind === 'user' && user.text, user?.kind === 'user' && user.pending], ['user', 'Say hi', true])
    assert.equal(bot(h)?.transcript.running, true)
  })

  it('a task a voice call hands over is your bubble, sent as a voice-live turn with the recent spoken turns', async () => {
    const h = harness()
    await h.sessions.open('bot')
    await h.sessions.send('bot', 'Book the dentist for Thursday.', [], { voiceContext: 'You: Book the dentist.\nVoice: On it.' })
    assert.deepEqual(h.calls.at(-1), {
      method: 'prompt.submit',
      params: { session_id: 'live-1', text: 'Book the dentist for Thursday.', surface: 'voice-live', voice_context: 'You: Book the dentist.\nVoice: On it.' },
    })
  })

  it('opens the chat first when it is not open yet', async () => {
    const h = harness()
    await h.sessions.send('bot', 'hello')
    assert.deepEqual(methods(h), ['session.resume', 'prompt.submit'])
  })

  it('ignores empty messages', async () => {
    const h = harness()
    await h.sessions.send('bot', '   ')
    assert.deepEqual(methods(h), [])
  })

  it('batches deltas and flushes structural events at once, in order', async () => {
    const h = harness()
    h.setPage(() => [])
    await h.sessions.open('bot')
    const events = capture('approval', 'live-1')

    for (const event of events) {
      h.emit(event)
    }

    // The turn finished with message.complete, which flushes everything before it.
    const transcript = bot(h)!.transcript
    assert.deepEqual(transcript.items.map(item => item.kind), ['assistant', 'activity', 'approval', 'assistant'])
    assert.equal(transcript.running, false)
    assert.equal(h.timers.pending(), 0)
  })

  it('holds deltas until the batch timer fires', async () => {
    const h = harness()
    h.setPage(() => [])
    await h.sessions.open('bot')
    h.emit({ type: 'message.delta', session_id: 'live-1', payload: { text: 'Hel' } })
    h.emit({ type: 'message.delta', session_id: 'live-1', payload: { text: 'lo' } })
    assert.equal(bot(h)!.transcript.items.length, 0, 'not rendered yet')
    assert.equal(h.timers.pending(), 1, 'one timer for the whole batch')
    h.timers.runAll()
    assert.equal((bot(h)!.transcript.items[0] as { text: string }).text, 'Hello')
  })

  it('tracks session.info for the header', async () => {
    const h = harness()
    await h.sessions.open('bot')
    h.emit({ type: 'session.info', session_id: 'live-1', payload: { model: 'new-model', provider: 'p', running: false } })
    assert.equal(bot(h)?.info?.model, 'new-model')
  })

  it('ignores events for sessions it does not know', async () => {
    const h = harness()
    h.setPage(() => [])
    await h.sessions.open('bot')
    h.emit({ type: 'message.complete', session_id: 'someone-else', payload: { text: 'x', status: 'complete' } })
    assert.equal(bot(h)!.transcript.items.length, 0)
  })

  it('stop interrupts the live session', async () => {
    const h = harness()
    await h.sessions.open('bot')
    await h.sessions.stop('bot')
    assert.deepEqual(h.calls.at(-1), { method: 'session.interrupt', params: { session_id: 'live-1' } })
  })
})

describe('send failures', () => {
  it('drops the optimistic bubble and shows the error', async () => {
    const h = harness()
    await h.sessions.open('bot')
    h.handlers['prompt.submit'] = () => {
      throw new Error('gateway not connected')
    }
    await h.sessions.send('bot', 'hello')
    const items = bot(h)!.transcript.items
    assert.equal(items.some(item => item.kind === 'user' && item.pending), false)
    assert.deepEqual([items.at(-1)?.kind, items.at(-1)?.kind === 'error' && (items.at(-1) as { message: string }).message], ['error', 'Not connected to the server.'])
    assert.equal(bot(h)?.transcript.running, false)
  })

  it('re-attaches and retries once on a stale live id (4001) without showing an error', async () => {
    const h = harness()
    await h.sessions.open('bot')
    let submits = 0
    h.handlers['prompt.submit'] = params => {
      if (++submits === 1) {
        throw rpcError(4001)
      }
      return { status: 'streaming', echo: params.session_id }
    }
    await h.sessions.send('bot', 'hello')
    assert.equal(submits, 2)
    assert.equal(h.calls.filter(call => call.method === 'prompt.submit').at(-1)?.params.session_id, 'live-2', 'retried on the re-keyed id')
    const items = bot(h)!.transcript.items
    assert.equal(items.some(item => item.kind === 'error'), false)
    assert.equal(items.filter(item => item.kind === 'user' && item.text === 'hello').length, 1)
  })
})

describe('prompts', () => {
  async function withApproval() {
    const h = harness()
    h.setPage(() => [])
    await h.sessions.open('bot')
    h.emit({ type: 'message.start', session_id: 'live-1', payload: {} })
    h.emit({ type: 'approval.request', session_id: 'live-1', payload: { command: 'rm -r /x', description: 'delete', request_id: 'r1', choices: ['once', 'session', 'always', 'deny'] } })
    return h
  }

  it('answering an approval records the choice', async () => {
    const h = await withApproval()
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 1)
    assert.equal(await h.sessions.respondApproval('bot', 'r1', 'session'), 'answered')
    assert.deepEqual(h.calls.at(-1), { method: 'approval.respond', params: { session_id: 'live-1', request_id: 'r1', choice: 'session' } })
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 0)
  })

  it('resolved 0 means it already expired', async () => {
    const h = await withApproval()
    h.handlers['approval.respond'] = () => ({ resolved: 0 })
    assert.equal(await h.sessions.respondApproval('bot', 'r1', 'once'), 'expired')
    const item = bot(h)!.transcript.items.find(entry => entry.kind === 'approval')
    assert.equal(item?.kind === 'approval' && item.state, 'expired')
  })

  it('a failed respond leaves the prompt pending so it can be retried', async () => {
    const h = await withApproval()
    h.handlers['approval.respond'] = () => {
      throw new Error('boom')
    }
    assert.equal(await h.sessions.respondApproval('bot', 'r1', 'once'), 'failed')
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 1)
  })

  it('answers questions, and secrets are sent but never kept', async () => {
    const h = harness()
    h.setPage(() => [])
    h.handlers['secret.respond'] = () => ({ status: 'ok' })
    await h.sessions.open('bot')
    h.emit({ type: 'clarify.request', session_id: 'live-1', payload: { request_id: 'q1', questions: [{ question: 'A or B?', choices: ['A', 'B'] }] } })
    h.emit({ type: 'secret.request', session_id: 'live-1', payload: { request_id: 's1', prompt: 'Key', env_var: 'API_KEY' } })

    assert.equal(await h.sessions.respondClarify('bot', 'q1', [{ questionId: 'q0', answer: 'B' }]), 'answered')
    assert.deepEqual(h.calls.at(-1)?.params, { session_id: 'live-1', request_id: 'q1', answer: 'B', question_id: 'q0' })
    assert.equal(await h.sessions.respondSecret('bot', 's1', 'super-secret-value'), 'answered')
    assert.equal(h.calls.at(-1)?.params.value, 'super-secret-value')
    assert.equal(JSON.stringify(h.sessions.store.getState()).includes('super-secret-value'), false)
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 0)
  })

  it('sends one answer per question, and reports an expired prompt', async () => {
    const h = harness()
    h.setPage(() => [])
    await h.sessions.open('bot')
    h.emit({
      type: 'clarify.request',
      session_id: 'live-1',
      payload: { request_id: 'q1', questions: [{ qid: 'q0', question: 'A?', choices: ['x'] }, { qid: 'q1', question: 'B?', multi_select: true, choices: ['y', 'z'] }] },
    })
    assert.equal(await h.sessions.respondClarify('bot', 'q1', [{ questionId: 'q0', answer: 'x' }, { questionId: 'q1', answer: '["y","z"]' }]), 'answered')
    const sent = h.calls.filter(call => call.method === 'clarify.respond').map(call => [call.params.question_id, call.params.answer])
    assert.deepEqual(sent, [['q0', 'x'], ['q1', '["y","z"]']])
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 0)

    const e = harness()
    e.setPage(() => [])
    e.handlers['clarify.respond'] = () => ({ status: 'expired' })
    await e.sessions.open('bot')
    e.emit({ type: 'clarify.request', session_id: 'live-1', payload: { request_id: 'q9', questions: [{ qid: 'q0', question: 'A?' }] } })
    assert.equal(await e.sessions.respondClarify('bot', 'q9', [{ questionId: 'q0', answer: 'x' }]), 'expired')
    assert.equal((bot(e)!.transcript.items.find(item => item.kind === 'question') as { state: string }).state, 'expired')
  })

  it('cannot respond before the chat is open', async () => {
    const h = harness()
    assert.equal(await h.sessions.respondApproval('bot', 'r1', 'once'), 'failed')
  })
})

describe('paging back', () => {
  const rows = (from: number, to: number): StoredMessage[] =>
    Array.from({ length: to - from }, (_, i) => ({ id: from + i, role: i % 2 ? 'assistant' : 'user', content: `m${from + i}` }))

  it('merges an older page in order and keeps live items', async () => {
    const h = harness()
    h.setPage(offset => (offset === 0 ? rows(PAGE_SIZE, PAGE_SIZE * 2) : rows(0, PAGE_SIZE)))
    await h.sessions.open('bot')
    assert.equal(bot(h)?.hasOlder, true, 'a full page means there may be more')

    h.emit({ type: 'message.delta', session_id: 'live-1', payload: { text: 'live reply' } })
    h.timers.runAll()
    await h.sessions.loadOlder('bot')

    const items = bot(h)!.transcript.items
    assert.equal(items.length, PAGE_SIZE * 2 + 1)
    assert.equal((items[0] as { text: string }).text, 'm0')
    assert.equal((items.at(-1) as { text: string }).text, 'live reply')
    assert.equal(bot(h)?.loadingOlder, false)
    assert.equal(bot(h)?.hasOlder, true)
  })

  it('does nothing when there is no older page', async () => {
    const h = harness()
    await h.sessions.open('bot')
    const callsBefore = h.calls.length
    await h.sessions.loadOlder('bot')
    assert.equal(h.calls.length, callsBefore)
  })
})

describe('reattach', () => {
  it('re-resumes every open chat silently and re-keys by the new live id', async () => {
    const h = harness()
    await h.sessions.open('bot')
    await h.sessions.reattachAll()
    assert.equal(bot(h)?.phase, 'ready')
    assert.equal(bot(h)?.liveId, 'live-2')
    assert.deepEqual(h.sessions.knownLiveIds(), { bot: ['live-2'] })

    // Events still addressed to the old live id no longer reach the chat.
    const before = bot(h)!.transcript.items.length
    h.emit({ type: 'message.complete', session_id: 'live-1', payload: { text: 'late', status: 'complete' } })
    assert.equal(bot(h)!.transcript.items.length, before)
  })

  it('keeps the chat on screen if the re-attach fails', async () => {
    const h = harness()
    await h.sessions.open('bot')
    h.handlers['session.resume'] = () => {
      throw new Error('offline')
    }
    await h.sessions.reattachAll()
    assert.equal(bot(h)?.phase, 'ready')
    assert.equal(bot(h)?.error, 'offline')
    assert.ok(bot(h)!.transcript.items.length > 0)
  })

  it('tries again a chat that failed to open, as one opened before the socket was up', async () => {
    const h = harness()
    const resume = h.handlers['session.resume']!
    h.handlers['session.resume'] = () => {
      throw new Error('gateway not connected')
    }
    await h.sessions.open('bot')
    assert.equal(bot(h)?.phase, 'error')

    h.handlers['session.resume'] = resume
    await h.sessions.reattachAll()
    assert.equal(bot(h)?.phase, 'ready')
    assert.equal(bot(h)?.error, null)
  })

  it('has nothing to do when no chat is open', async () => {
    const h = harness()
    await h.sessions.reattachAll()
    assert.deepEqual(methods(h), [])
  })
})

describe('prompts asked as server requests (Hermes 0.21.5+)', () => {
  /** A bridge that records the answers the controller gives it. */
  function recordingBridge(outcome: 'sent' | 'unknown' | 'failed' = 'sent') {
    const answers: unknown[][] = []
    const ingested: unknown[][] = []
    const bridge: Pick<RequestBridge, 'answer' | 'ingest'> = {
      answer: (id, answer) => (answers.push([id, answer]), outcome),
      ingest: (sid, snapshot) => void ingested.push([sid, snapshot]),
    }

    return { bridge, answers, ingested }
  }

  const approval = (h: Harness, requestId = 'req-1') => h.emit({ type: 'approval.request', session_id: 'live-1', payload: { request_id: requestId, command: 'rm -r /x', description: 'delete', choices: ['once', 'deny'] } } as GatewayEvent)

  it('an approval is answered as the response to the request: no RPC goes out', async () => {
    const { bridge, answers } = recordingBridge()
    const h = harness(bridge)
    await h.sessions.open('bot')
    approval(h)
    h.timers.runAll()

    assert.equal(await h.sessions.respondApproval('bot', 'req-1', 'session'), 'answered')
    assert.deepEqual(answers, [['req-1', { kind: 'approval', choice: 'session' }]])
    assert.ok(!methods(h).includes('approval.respond'), 'no approval.respond RPC')
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 0, 'the card is settled')
  })

  it('a question is answered as a response too, with every answer in one go', async () => {
    const { bridge, answers } = recordingBridge()
    const h = harness(bridge)
    await h.sessions.open('bot')
    h.emit({ type: 'clarify.request', session_id: 'live-1', payload: { request_id: 'srq-1', questions: [{ qid: 'q0', question: 'A?' }, { qid: 'q1', question: 'B?' }] } } as GatewayEvent)
    h.timers.runAll()

    assert.equal(await h.sessions.respondClarify('bot', 'srq-1', [{ questionId: 'q0', answer: 'x' }, { questionId: 'q1', answer: 'y' }]), 'answered')
    assert.deepEqual(answers, [['srq-1', { kind: 'clarify', answers: [{ questionId: 'q0', answer: 'x' }, { questionId: 'q1', answer: 'y' }] }]])
    assert.ok(!methods(h).includes('clarify.respond'))
  })

  it('sudo and secret values go out as the response and are never kept', async () => {
    const { bridge, answers } = recordingBridge()
    const h = harness(bridge)
    await h.sessions.open('bot')
    h.emit({ type: 'sudo.request', session_id: 'live-1', payload: { request_id: 'srq-2' } } as GatewayEvent)
    h.emit({ type: 'secret.request', session_id: 'live-1', payload: { request_id: 'srq-3', env_var: 'TOKEN', prompt: 'Token' } } as GatewayEvent)
    h.timers.runAll()

    assert.equal(await h.sessions.respondSudo('bot', 'srq-2', 'pw1'), 'answered')
    assert.equal(await h.sessions.respondSecret('bot', 'srq-3', 'tok1'), 'answered')
    assert.deepEqual(answers, [['srq-2', { kind: 'value', value: 'pw1' }], ['srq-3', { kind: 'value', value: 'tok1' }]])
    assert.ok(!JSON.stringify(bot(h)).includes('pw1') && !JSON.stringify(bot(h)).includes('tok1'), 'the values are not in state')
  })

  it('a closed socket is reported as a failure and the card stays', async () => {
    const { bridge } = recordingBridge('failed')
    const h = harness(bridge)
    await h.sessions.open('bot')
    approval(h)
    h.timers.runAll()

    assert.equal(await h.sessions.respondApproval('bot', 'req-1', 'once'), 'failed')
    assert.equal(pendingPrompts(bot(h)!.transcript).length, 1)
  })

  it('a prompt that did not arrive as a request still uses the RPC (Hermes 0.21.0)', async () => {
    const { bridge } = recordingBridge('unknown')
    const h = harness(bridge)
    await h.sessions.open('bot')
    approval(h)
    h.timers.runAll()

    assert.equal(await h.sessions.respondApproval('bot', 'req-1', 'once'), 'answered')
    assert.ok(methods(h).includes('approval.respond'))
  })

  it('with no bridge at all, nothing changes', async () => {
    const h = harness()
    await h.sessions.open('bot')
    approval(h)
    h.timers.runAll()

    assert.equal(await h.sessions.respondApproval('bot', 'req-1', 'once'), 'answered')
    assert.ok(methods(h).includes('approval.respond'))
  })

  it('requests still open when a chat is resumed are handed to the bridge, for the session just resumed', async () => {
    const { bridge, ingested } = recordingBridge()
    const h = harness(bridge)
    const open_requests = [{ id: 'srq-9', method: 'clarify', params: { question: 'Still there?' } }]
    h.handlers['session.resume'] = () => ({ session_id: 'live-7', session_key: 'stored-1', running: true, inflight: null, open_requests })
    await h.sessions.open('bot')

    assert.deepEqual(ingested, [['live-7', open_requests]])
  })
})

describe('choosing a chat', () => {
  /** A harness whose server knows a second stored chat, and can create and delete chats. */
  function withChats() {
    const h = harness()
    h.handlers['session.resume'] = params => ({ session_id: `live-${h.nextLive.value++}`, session_key: String(params.session_id), running: false, inflight: null, info: { model: 'm', provider: 'p' } })
    h.handlers['session.create'] = () => ({ session_id: 'live-new', stored_session_id: 'stored-new', info: { model: 'm', provider: 'p' } })
    h.handlers['session.close'] = () => ({ closed: true })
    h.handlers['session.delete'] = params => ({ deleted: String(params.session_id) })
    h.handlers['session.list'] = () => ({
      sessions: [
        { id: 'stored-2', title: 'Deploy', preview: 'Deploying', started_at: 20, message_count: 6, source: 'tui' },
        { id: 'run-1', title: 'Nightly', preview: '', started_at: 30, message_count: 2, source: 'cron' },
      ],
    })

    return h
  }

  it('shows the main chat until another is chosen', async () => {
    const h = withChats()
    await h.sessions.open('bot')
    assert.deepEqual(h.sessions.store.getState().chosen, {})
    assert.equal(h.calls[0]?.params.session_id, 'stored-1')
  })

  it('opens a chosen chat nobody has written in yet (no stored row, so no history) as an empty chat', async () => {
    const h = withChats()
    h.setPage(() => {
      throw new HermesHttpError(404, 'GET /api/sessions/unwritten/messages → 404 {"detail":"Session not found"}')
    })
    await h.sessions.openChat('bot', 'unwritten')
    assert.equal(bot(h)?.phase, 'ready')
    assert.equal(bot(h)?.storedId, 'unwritten')
    assert.equal(bot(h)?.transcript.items.length, 0)
  })

  it('still reports a missing history for a chat that should have one', async () => {
    const h = withChats()
    h.setPage(() => {
      throw new HermesHttpError(404, 'gone')
    })
    await h.sessions.open('bot')
    assert.equal(bot(h)?.phase, 'error')
  })

  it('forgets a deleted bot: its chat, its live id and which chat it was on', async () => {
    const h = withChats()
    await h.sessions.openChat('bot', 'stored-2')
    const live = bot(h)?.liveId ?? ''
    h.sessions.forget('bot')
    assert.equal(bot(h), undefined)
    assert.deepEqual(h.sessions.store.getState().chosen, {})
    assert.deepEqual(h.sessions.knownLiveIds(), {})
    h.emit({ type: 'message.delta', session_id: live, payload: { text: 'late' } })
    h.timers.runAll()
    assert.equal(bot(h), undefined)
  })

  it('opens another stored chat, which is then the one that opens next time', async () => {
    const h = withChats()
    await h.sessions.open('bot')
    await h.sessions.openChat('bot', 'stored-2')

    assert.deepEqual(h.sessions.store.getState().chosen, { bot: 'stored-2' })
    assert.equal(bot(h)?.storedId, 'stored-2')
    assert.equal(h.calls.at(-1)?.params.session_id, 'stored-2')

    await h.sessions.open('bot', { silent: true })
    assert.equal(h.calls.at(-1)?.params.session_id, 'stored-2', 're-attaching keeps the chosen chat')
  })

  it('a link (a notification) opens the side chat it names, and the main chat when it names that one', async () => {
    const h = withChats()
    await h.sessions.openLinked('bot', 'stored-2')
    assert.deepEqual(h.sessions.store.getState().chosen, { bot: 'stored-2' })
    assert.equal(bot(h)?.storedId, 'stored-2')

    await h.sessions.openLinked('bot', 'stored-1')
    assert.deepEqual(h.sessions.store.getState().chosen, {}, 'the canonical id is the main chat, not a side chat')
    assert.equal(bot(h)?.storedId, 'stored-1')
  })

  it('a link that arrives before the roster (a cold start) asks the server which chat is the main one', async () => {
    const h = withChats()
    h.setRoster([row('bot')])
    h.handlers['session.list'] = params => ({ sessions: params.title === 'Bot Chat' ? [{ id: 'old', resolved_id: 'stored-1', title: 'Bot Chat' }] : [] })

    await h.sessions.openLinked('bot', 'stored-1')
    assert.deepEqual(h.sessions.store.getState().chosen, {}, 'the main chat, not a side chat')
    assert.equal(bot(h)?.storedId, 'stored-1')

    await h.sessions.openLinked('bot', 'stored-2')
    assert.deepEqual(h.sessions.store.getState().chosen, { bot: 'stored-2' })
  })

  it('a link to the chat already on screen only re-attaches it', async () => {
    const h = withChats()
    await h.sessions.openChat('bot', 'stored-2')
    const items = bot(h)?.transcript.items.length
    const resumes = methods(h).filter(method => method === 'session.resume').length

    await h.sessions.openLinked('bot', 'stored-2')
    assert.equal(bot(h)?.transcript.items.length, items, 'nothing was cleared')
    assert.equal(methods(h).filter(method => method === 'session.resume').length, resumes + 1)
    assert.equal(h.calls.at(-1)?.params.session_id, 'stored-2')
  })

  it('goes back to the main chat with null', async () => {
    const h = withChats()
    await h.sessions.openChat('bot', 'stored-2')
    await h.sessions.openChat('bot', null)

    assert.deepEqual(h.sessions.store.getState().chosen, {})
    assert.equal(bot(h)?.storedId, 'stored-1')
  })

  it('shows nothing of the old chat while the new one loads, and ignores a turn still running in the old one', async () => {
    const h = withChats()
    await h.sessions.open('bot')
    const oldLive = bot(h)?.liveId
    assert.ok(oldLive)
    assert.ok((bot(h)?.transcript.items.length ?? 0) > 0)

    h.setPage(() => [])
    await h.sessions.openChat('bot', 'stored-2')
    assert.equal(bot(h)?.transcript.items.length, 0)

    h.emit({ type: 'message.delta', session_id: oldLive, payload: { text: 'from the old chat' } })
    h.timers.runAll()
    assert.equal(bot(h)?.transcript.items.length, 0, 'the old chat no longer writes here')
    assert.deepEqual(h.sessions.knownLiveIds(), { bot: [bot(h)?.liveId] })
  })

  it('falls back to the main chat when the side chat no longer exists', async () => {
    const h = withChats()
    h.handlers['session.resume'] = params => {
      if (params.session_id === 'gone') {
        throw rpcError(4007, 'session not found')
      }

      return { session_id: `live-${h.nextLive.value++}`, session_key: String(params.session_id), running: false, inflight: null }
    }
    await h.sessions.openChat('bot', 'gone')

    assert.deepEqual(h.sessions.store.getState().chosen, {})
    assert.equal(bot(h)?.storedId, 'stored-1')
    assert.equal(bot(h)?.phase, 'ready')
  })

  describe('a side chat is temporary', () => {
    it('is forgotten when the bot is left, so the next open is the main chat', async () => {
      const h = withChats()
      await h.sessions.openChat('bot', 'stored-2')
      assert.deepEqual(h.sessions.store.getState().chosen, { bot: 'stored-2' })

      h.sessions.leaveSide('bot')
      assert.deepEqual(h.sessions.store.getState().chosen, {})

      await h.sessions.open('bot')
      assert.equal(bot(h)?.storedId, 'stored-1')
    })

    it('shows the main chat at once when the bot is left, not the side chat, while the main chat opens again', async () => {
      const h = withChats()
      await h.sessions.open('bot')
      const main = bot(h)?.transcript
      assert.ok((main?.items.length ?? 0) > 0)

      h.setPage(() => [])
      await h.sessions.openChat('bot', 'stored-2')
      const sideLive = bot(h)?.liveId
      h.sessions.leaveSide('bot')

      assert.equal(bot(h)?.transcript, main, 'the main chat as it was, straight away')
      assert.equal(bot(h)?.storedId, 'stored-1')
      assert.equal(bot(h)?.phase, 'opening')

      h.emit({ type: 'message.delta', session_id: sideLive ?? '', payload: { text: 'from the side chat' } })
      h.timers.runAll()
      assert.equal(bot(h)?.transcript, main, 'the side chat no longer writes here')
    })

    it('shows nothing old when the main chat was never on screen (a side chat opened first)', async () => {
      const h = withChats()
      await h.sessions.openChat('bot', 'stored-2')
      h.sessions.leaveSide('bot')
      assert.equal(bot(h)?.transcript.items.length, 0)
      assert.equal(bot(h)?.phase, 'idle')
    })

    it('leaves nothing deleted or closed on the server', async () => {
      const h = withChats()
      await h.sessions.openChat('bot', 'stored-2')
      h.sessions.leaveSide('bot')
      assert.ok(!methods(h).includes('session.delete'))
      assert.ok(!methods(h).includes('session.close'))
    })

  })

  describe('a new chat', () => {
    it('does nothing when the side chat you are in has nothing in it yet', async () => {
      const h = withChats()
      h.setPage(() => [])
      await h.sessions.openChat('bot', 'stored-2')
      h.calls.length = 0
      assert.equal(await h.sessions.newChat('bot'), null)
      assert.ok(!methods(h).includes('session.create'))
      assert.deepEqual(h.sessions.store.getState().chosen, { bot: 'stored-2' })
    })

    it('still starts a side chat from a main chat that is empty', async () => {
      const h = withChats()
      h.setPage(() => [])
      await h.sessions.open('bot')
      assert.equal(await h.sessions.newChat('bot'), null)
      assert.ok(methods(h).includes('session.create'))
    })

    it('is created without being hidden, shown empty, and chosen', async () => {
      const h = withChats()
      await h.sessions.open('bot')
      const error = await h.sessions.newChat('bot')

      assert.equal(error, null)
      assert.deepEqual(h.calls.find(call => call.method === 'session.create')?.params, { profile: 'bot' })
      assert.equal(bot(h)?.storedId, 'stored-new')
      assert.equal(bot(h)?.liveId, 'live-new')
      assert.equal(bot(h)?.phase, 'ready')
      assert.equal(bot(h)?.transcript.items.length, 0)
      assert.deepEqual(h.sessions.store.getState().chosen, { bot: 'stored-new' })
    })

    it('takes over the live events, and lets go of the old chat', async () => {
      const h = withChats()
      await h.sessions.open('bot')
      const oldLive = bot(h)?.liveId ?? 'missing'
      await h.sessions.newChat('bot')

      h.emit({ type: 'message.delta', session_id: oldLive, payload: { text: 'old' } })
      h.emit({ type: 'message.start', session_id: 'live-new', payload: {} })
      h.emit({ type: 'message.delta', session_id: 'live-new', payload: { text: 'hello' } })
      h.timers.runAll()
      const texts = (bot(h)?.transcript.items ?? []).flatMap(item => (item.kind === 'assistant' ? [item.text] : []))
      assert.deepEqual(texts, ['hello'])
    })

    it('sends the next message to the new chat', async () => {
      const h = withChats()
      await h.sessions.newChat('bot')
      await h.sessions.send('bot', 'hi')
      const submit = h.calls.find(call => call.method === 'prompt.submit')
      assert.deepEqual(submit?.params, { session_id: 'live-new', text: 'hi' })
    })

    it('reports a failure and changes nothing', async () => {
      const h = withChats()
      await h.sessions.open('bot')
      h.handlers['session.create'] = () => {
        throw rpcError(5000, 'no capacity')
      }

      assert.equal(await h.sessions.newChat('bot'), 'no capacity')
      assert.equal(bot(h)?.storedId, 'stored-1')
      assert.deepEqual(h.sessions.store.getState().chosen, {})
    })
  })

  describe('the history', () => {
    it('lists the bot’s stored chats a page at a time, without routines or kanban workers', async () => {
      const h = withChats()
      h.setChats(({ offset }) => ({ sessions: offset ? [] : [{ id: 'stored-2', title: 'Deploy', preview: 'Deploying', started_at: 20, message_count: 6, source: 'tui' }], total: 31 }))
      const first = await h.sessions.listChats('bot')
      assert.deepEqual(h.chatQueries[0], { offset: 0, limit: 30, excludeSources: ['cron', 'kanban', 'tool', 'oneshot'] })
      assert.deepEqual(first, { chats: [{ id: 'stored-2', title: 'Deploy', preview: 'Deploying', startedAt: 20, messageCount: 6, source: 'tui' }], total: 31, next: 30 })
      await h.sessions.listChats('bot', 30)
      assert.equal(h.chatQueries[1]?.offset, 30)
      assert.equal(h.calls.length, 0, 'the paged list is REST, not session.list')
    })

    it('leaves out the pinned chats the server adds after a page, so each comes on its own page in date order', async () => {
      const h = withChats()
      const row = (n: number, pinned = false) => ({ id: `c${n}`, title: `Chat ${n}`, preview: '', started_at: 1000 - n, message_count: 1, source: 'tui', pinned })
      h.setChats(({ offset }) => ({ sessions: [...Array.from({ length: 30 }, (_, i) => row(offset + i)), row(90, true)], total: 100 }))
      const page = await h.sessions.listChats('bot', 30)
      assert.equal(page.chats.length, 30)
      assert.equal(page.chats.at(-1)?.id, 'c59')
      assert.ok(!page.chats.some(chat => chat.id === 'c90'))
      assert.equal(page.next, 60, 'the next page starts after this one, however many rows came back')
    })

    it('fills in what a stored chat leaves out', async () => {
      const h = withChats()
      h.setChats(() => ({ sessions: [{ id: 'bare', title: null, preview: null, started_at: null, message_count: null, source: null }], total: 1 }))
      const { chats } = await h.sessions.listChats('bot')
      assert.deepEqual(chats, [{ id: 'bare', title: '', preview: '', startedAt: 0, messageCount: 0, source: '' }])
    })

    it('finds the bot’s inbox by its title, at the chat it was continued into', async () => {
      const h = withChats()
      h.handlers['session.list'] = params =>
        params.title === 'Bot Inbox' ? { sessions: [{ id: 'inbox-root', resolved_id: 'inbox-tip', title: 'Bot Inbox #2', preview: 'Scout asked', started_at: 50, message_count: 12, source: 'cli' }] } : { sessions: [] }
      const inbox = await h.sessions.findInbox('bot')
      assert.deepEqual(h.calls[0], { method: 'session.list', params: { profile: 'bot', title: 'Bot Inbox', include_hidden: true, limit: 1 } })
      assert.deepEqual(inbox, { id: 'inbox-tip', title: 'Bot Inbox #2', preview: 'Scout asked', startedAt: 50, messageCount: 12, source: 'cli' })
    })

    it('has no inbox when the server has none', async () => {
      const h = withChats()
      h.handlers['session.list'] = () => ({ sessions: [] })
      assert.equal(await h.sessions.findInbox('bot'), null)
    })
  })

  describe('deleting a chat', () => {
    it('refuses the main chat', async () => {
      const h = withChats()
      assert.equal(await h.sessions.deleteChat('bot', 'stored-1'), 'The main chat can’t be deleted.')
      assert.ok(!methods(h).includes('session.delete'))
    })

    it('deletes a chat that is not open', async () => {
      const h = withChats()
      await h.sessions.open('bot')
      assert.equal(await h.sessions.deleteChat('bot', 'stored-2'), null)
      assert.deepEqual(h.calls.at(-1), { method: 'session.delete', params: { session_id: 'stored-2', profile: 'bot' } })
      assert.equal(bot(h)?.storedId, 'stored-1', 'the open chat is untouched')
    })

    it('closes the open chat, goes back to the main chat, then deletes it', async () => {
      const h = withChats()
      await h.sessions.openChat('bot', 'stored-2')
      const live = bot(h)?.liveId
      assert.equal(await h.sessions.deleteChat('bot', 'stored-2'), null)

      const closeAt = methods(h).lastIndexOf('session.close')
      const deleteAt = methods(h).lastIndexOf('session.delete')
      assert.ok(closeAt > -1 && closeAt < deleteAt, 'closed before it is deleted')
      assert.equal(h.calls[closeAt]?.params.session_id, live)
      assert.equal(bot(h)?.storedId, 'stored-1')
      assert.deepEqual(h.sessions.store.getState().chosen, {})
    })

    it('says why when the server refuses', async () => {
      const h = withChats()
      h.handlers['session.delete'] = () => {
        throw rpcError(4090, 'session is live')
      }

      assert.equal(await h.sessions.deleteChat('bot', 'stored-2'), 'This chat is open on another device. Close it there, or try again.')
    })
  })
})

describe('sending with attachments', () => {
  const photo = { id: 'a1', kind: 'image' as const, name: 'photo.jpg', mime: 'image/jpeg', uri: 'file:///cache/photo.jpg', size: 1000 }
  const notes = { id: 'a2', kind: 'file' as const, name: 'notes.txt', mime: 'text/plain', uri: 'file:///cache/notes.txt', size: 50 }

  it('uploads each file to the live chat, then sends one message with the file references and your words', async () => {
    const h = harness()
    h.handlers['image.attach_bytes'] = () => ({ attached: true, text: '[User attached image: upload_1.jpg]' })
    h.handlers['file.attach'] = () => ({ attached: true, name: 'notes.txt', path: '/w/notes.txt', ref_text: '@file:notes.txt', uploaded: true })
    await h.sessions.open('bot')
    assert.equal(await h.sessions.send('bot', ' what is this? ', [photo, notes]), true)
    const calls = h.calls.filter(call => !['session.resume'].includes(call.method))
    assert.deepEqual(calls.map(call => call.method), ['image.attach_bytes', 'file.attach', 'prompt.submit'])
    assert.equal(calls[0]?.params.session_id, 'live-1')
    assert.equal(calls[0]?.params.content_base64, Buffer.from('file:///cache/photo.jpg').toString('base64'))
    assert.equal(calls[2]?.params.text, '@file:notes.txt\nwhat is this?')
    // The bubble shows your words and what you attached, at once.
    const bubble = bot(h)!.transcript.items.at(-1)
    assert.deepEqual(bubble?.kind === 'user' && bubble.attachments, [{ kind: 'image', name: 'photo.jpg', uri: 'file:///cache/photo.jpg' }, { kind: 'file', name: 'notes.txt' }])
  })

  it('sends a picture with no words as what the server calls it', async () => {
    const h = harness()
    h.handlers['image.attach_bytes'] = () => ({ attached: true, text: '[User attached image: upload_1.jpg]' })
    await h.sessions.open('bot')
    assert.equal(await h.sessions.send('bot', '', [photo]), true)
    assert.equal(h.calls.find(call => call.method === 'prompt.submit')?.params.text, '[User attached image: upload_1.jpg]')
  })

  it('says why and sends nothing when the server refuses a file', async () => {
    const h = harness()
    h.handlers['file.attach'] = () => {
      throw new JsonRpcGatewayError('file type not allowed', { code: 5028 })
    }
    await h.sessions.open('bot')
    const before = bot(h)!.transcript.items.filter(item => item.kind === 'user').length
    assert.equal(await h.sessions.send('bot', 'here', [notes]), false)
    assert.equal(h.calls.some(call => call.method === 'prompt.submit'), false)
    const items = bot(h)!.transcript.items
    assert.equal(items.at(-1)?.kind, 'error')
    // The bubble that appeared at once is gone again.
    assert.equal(items.filter(item => item.kind === 'user').length, before)
  })

  it('refuses a file that is too large before uploading anything', async () => {
    const h = harness()
    await h.sessions.open('bot')
    assert.equal(await h.sessions.send('bot', '', [{ ...notes, size: 26 * 1024 * 1024 }]), false)
    assert.equal(h.calls.some(call => call.method === 'file.attach'), false)
    assert.match(String((bot(h)!.transcript.items.at(-1) as { message?: string }).message), /limit is 25\.0 MB/)
  })

  it('tells you when a file cannot be read from the phone', async () => {
    const h = harness()
    await h.sessions.open('bot')
    assert.equal(await h.sessions.send('bot', 'x', [{ ...photo, uri: 'file:///missing.jpg' }]), false)
    assert.match(String((bot(h)!.transcript.items.at(-1) as { message?: string }).message), /Could not read that file/)
  })

  it('uploads again on the new chat when the old one went stale', async () => {
    const h = harness()
    let first = true
    h.handlers['image.attach_bytes'] = () => {
      if (first) {
        first = false
        throw new JsonRpcGatewayError('session not found', { code: 4001 })
      }

      return { attached: true, text: '[User attached image: upload_1.jpg]' }
    }
    await h.sessions.open('bot')
    const before = bot(h)!.transcript.items.filter(item => item.kind === 'user').length
    assert.equal(await h.sessions.send('bot', 'look', [photo]), true)
    assert.deepEqual(h.calls.map(call => call.method).filter(method => method !== 'session.resume'), ['image.attach_bytes', 'image.attach_bytes', 'prompt.submit'])
    assert.equal(bot(h)!.transcript.items.filter(item => item.kind === 'user').length, before + 1)
  })

  it('still sends plain words as before', async () => {
    const h = harness()
    await h.sessions.open('bot')
    assert.equal(await h.sessions.send('bot', 'hello'), true)
    assert.equal(await h.sessions.send('bot', '   '), false)
    assert.deepEqual(h.calls.filter(call => call.method === 'prompt.submit').map(call => call.params.text), ['hello'])
  })
})

describe('running a slash command', () => {
  const items = (h: Harness) => bot(h)!.transcript.items
  const SKILL = ['[IMPORTANT: The user has invoked the "work" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]', '', '# Work', '', 'The user has provided the following instruction alongside the skill invocation: fix the leak'].join('\n')

  it('shows a built-in command’s output in the chat and sends nothing to the bot', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ output: 'Model: glm\nContext: 12%' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'status', '', 'exec', '/status'), { ok: true })
    assert.deepEqual(h.calls.find(call => call.method === 'slash.exec')?.params, { session_id: 'live-1', command: '/status' })
    assert.equal(h.calls.some(call => call.method === 'prompt.submit'), false)
    const last = items(h).at(-1)
    assert.deepEqual(last && last.kind === 'output' ? [last.command, last.text] : null, ['/status', 'Model: glm\nContext: 12%'])
    // It is not a turn: nothing is running.
    assert.equal(bot(h)!.transcript.running, false)
  })

  it('sends a skill as the skill and shows what you typed', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = () => ({ type: 'skill', message: SKILL, name: 'work', display: '/work fix the leak' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'work', 'fix the leak', 'dispatch', '/work fix the leak'), { ok: true })
    assert.deepEqual(h.calls.find(call => call.method === 'command.dispatch')?.params, { session_id: 'live-1', name: 'work', arg: 'fix the leak' })
    assert.equal(h.calls.find(call => call.method === 'prompt.submit')?.params.text, SKILL)
    const bubble = items(h).at(-1)
    assert.equal(bubble?.kind === 'user' && bubble.text, '/work fix the leak')
    assert.equal(bot(h)!.transcript.running, true)
  })

  it('reads the invocation out of the skill when an older server sends no display text', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = () => ({ type: 'skill', message: SKILL })
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'work', 'fix the leak', 'dispatch', '/work fix the leak')
    const bubble = items(h).at(-1)
    assert.equal(bubble?.kind === 'user' && bubble.text, '/work fix the leak')
  })

  it('says what a command did and then sends its message (a goal)', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = () => ({ type: 'send', notice: '⊙ Goal set (20 turns): ship it', message: 'Work toward: ship it' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'goal', 'ship it', 'dispatch', '/goal ship it'), { ok: true })
    const list = items(h)
    assert.deepEqual(list.slice(-2).map(item => item.kind), ['output', 'user'])
    assert.equal(h.calls.find(call => call.method === 'prompt.submit')?.params.text, 'Work toward: ship it')
  })

  it('hands back words the server wants in the box', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = () => ({ type: 'prefill', message: 'earlier words', notice: '↶ Undid 1 turn' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'goal', '', 'dispatch', '/x'), { ok: true, prefill: 'earlier words' })
    assert.equal(items(h).at(-1)?.kind, 'output')
  })

  it('follows an alias once', async () => {
    const h = harness()
    const seen: string[] = []
    h.handlers['command.dispatch'] = params => {
      seen.push(String(params.name))
      return params.name === 'ship' ? { type: 'alias', target: 'deploy' } : { type: 'exec', output: 'deployed' }
    }
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'ship', '', 'dispatch', '/ship'), { ok: true })
    assert.deepEqual(seen, ['ship', 'deploy'])
    assert.equal(items(h).at(-1)?.kind === 'output' && (items(h).at(-1) as { text: string }).text, 'deployed')
  })

  it('does not follow an alias of an alias', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = params => ({ type: 'alias', target: params.name === 'a' ? 'b' : 'a' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'a', '', 'dispatch', '/a'), { ok: false })
    assert.equal(items(h).at(-1)?.kind, 'error')
  })

  it('names the command when the server does not know it, and leaves the words to come back', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = () => {
      throw rpcError(4018, 'not a quick/plugin/bundle/skill command: nope')
    }
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'nope', '', 'dispatch', '/nope'), { ok: false })
    assert.equal((items(h).at(-1) as { message?: string }).message, 'There is no command called /nope.')
  })

  it('shows a usage error from the server as it is, without stopping a turn that is running', async () => {
    const h = harness()
    h.handlers['command.dispatch'] = () => {
      throw rpcError(4004, 'usage: /steer <prompt>')
    }
    await h.sessions.open('bot')
    await h.sessions.send('bot', 'start something')
    assert.equal(bot(h)!.transcript.running, true)
    assert.deepEqual(await h.sessions.runCommand('bot', 'steer', '', 'dispatch', '/steer'), { ok: false })
    assert.equal((items(h).at(-1) as { message?: string }).message, 'usage: /steer <prompt>')
    assert.equal(bot(h)!.transcript.running, true)
  })

  it('runs it again on the new chat when the old one went stale', async () => {
    const h = harness()
    let first = true
    h.handlers['slash.exec'] = () => {
      if (first) {
        first = false
        throw rpcError(4001, 'session not found')
      }

      return { output: 'ok' }
    }
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'status', '', 'exec', '/status'), { ok: true })
    assert.deepEqual(h.calls.filter(call => call.method === 'slash.exec').map(call => call.params.session_id), ['live-1', 'live-2'])
  })

  it('tries command.dispatch when the server’s runner will not take the command', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => {
      throw rpcError(4018, 'skill command: use command.dispatch for /work')
    }
    h.handlers['command.dispatch'] = () => ({ type: 'skill', message: SKILL, display: '/work fix the leak' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'work', 'fix the leak', 'exec', '/work fix the leak'), { ok: true })
    assert.deepEqual(h.calls.filter(call => call.method === 'slash.exec' || call.method === 'command.dispatch').map(call => call.method), ['slash.exec', 'command.dispatch'])
    assert.equal(h.calls.find(call => call.method === 'prompt.submit')?.params.text, SKILL)
  })

  it('sends what the runner hands over as a dispatch answer (a goal typed as a built-in)', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ type: 'send', notice: '⊙ Goal set', message: 'Work toward: ship it' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'goal', 'ship it', 'exec', '/goal ship it'), { ok: true })
    assert.equal(h.calls.some(call => call.method === 'command.dispatch'), false)
    assert.deepEqual(items(h).slice(-2).map(item => item.kind), ['output', 'user'])
  })

  it('reads the chat again after a command that rewinds it, then shows what it said and gives back the words (/undo)', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ type: 'prefill', message: 'earlier words', notice: '↶ Undid 1 turn' })
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'undo', '', 'exec', '/undo'), { ok: true, prefill: 'earlier words' })
    assert.equal(h.calls.filter(call => call.method === 'session.resume').length, 2)
    // The notice comes after the re-read, which would otherwise have wiped it.
    assert.equal(items(h).at(-1)?.kind, 'output')
  })

  it('reads the chat again before resending the last message (/retry), so it is not shown twice', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ type: 'send', message: 'what I asked' })
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'retry', '', 'exec', '/retry')
    assert.deepEqual(h.calls.filter(call => ['slash.exec', 'session.resume', 'prompt.submit'].includes(call.method)).map(call => call.method), ['session.resume', 'slash.exec', 'session.resume', 'prompt.submit'])
    assert.equal(h.calls.find(call => call.method === 'prompt.submit')?.params.text, 'what I asked')
  })

  it('does not read the chat again after a command that leaves it alone', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ output: 'ok' })
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'status', '', 'exec', '/status')
    assert.equal(h.calls.filter(call => call.method === 'session.resume').length, 1)
  })

  it('shows what the runner said, not the dispatcher’s routing complaint, when neither can run the command', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => {
      throw rpcError(5030, 'slash worker start failed: boom')
    }
    h.handlers['command.dispatch'] = () => {
      throw rpcError(4018, 'not a quick/plugin/bundle/skill command: restart')
    }
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'restart', '', 'exec', '/restart'), { ok: false })
    assert.equal((items(h).at(-1) as { message?: string }).message, 'slash worker start failed: boom')
  })

  it('shows the dispatcher’s own error when that is the real one', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => {
      throw rpcError(5030, 'slash worker down')
    }
    h.handlers['command.dispatch'] = () => {
      throw rpcError(4004, 'usage: /queue <prompt>')
    }
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'queue', '', 'exec', '/queue')
    assert.equal((items(h).at(-1) as { message?: string }).message, 'usage: /queue <prompt>')
  })

  it('shows that a command is running until the server answers, then only what it said', async () => {
    const h = harness()
    let answer: (value: unknown) => void = () => undefined
    h.handlers['slash.exec'] = () => new Promise(resolve => (answer = resolve))
    await h.sessions.open('bot')
    const running = h.sessions.runCommand('bot', 'reasoning', '', 'exec', '/reasoning')
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    const waiting = items(h).at(-1)
    assert.deepEqual(waiting?.kind === 'output' && [waiting.command, waiting.pending], ['/reasoning', true])
    answer({ output: 'reasoning: medium' })
    assert.deepEqual(await running, { ok: true })
    const shown = items(h).filter(item => item.kind === 'output')
    assert.deepEqual(shown.map(item => (item.kind === 'output' ? [item.text, item.pending] : null)), [['reasoning: medium', undefined]])
  })

  it('takes the running line away when the command fails', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => {
      throw rpcError(5030, 'slash worker timed out')
    }
    h.handlers['command.dispatch'] = () => {
      throw rpcError(4018, 'not a quick/plugin/bundle/skill command: reasoning')
    }
    await h.sessions.open('bot')
    assert.deepEqual(await h.sessions.runCommand('bot', 'reasoning', '', 'exec', '/reasoning'), { ok: false })
    assert.deepEqual(items(h).filter(item => item.kind === 'output'), [])
    assert.equal((items(h).at(-1) as { message?: string }).message, 'slash worker timed out')
  })

  it('shows what a terminal program printed without its colour codes (an unknown command, for one)', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ output: '\u001b[1;31mUnknown command: /restart\u001b[0m\n\u001b[2mDid you mean /resume?\u001b[0m' })
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'restart', '', 'exec', '/restart')
    assert.equal((items(h).at(-1) as { text: string }).text, 'Unknown command: /restart\nDid you mean /resume?')
  })

  it('strips the colour codes from an error as well', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => {
      throw rpcError(5030, '\u001b[31mslash worker failed\u001b[0m')
    }
    h.handlers['command.dispatch'] = () => {
      throw rpcError(4018, 'not a quick/plugin/bundle/skill command: x')
    }
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'x', '', 'exec', '/x')
    assert.equal((items(h).at(-1) as { message?: string }).message, 'slash worker failed')
  })

  it('shows the runner’s warning above its output', async () => {
    const h = harness()
    h.handlers['slash.exec'] = () => ({ output: 'body', warning: 'skill discovery unavailable' })
    await h.sessions.open('bot')
    await h.sessions.runCommand('bot', 'tools', '', 'exec', '/tools')
    assert.equal((items(h).at(-1) as { text: string }).text, 'skill discovery unavailable\nbody')
  })
})
