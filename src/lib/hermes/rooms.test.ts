import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { RoomEvent, RoomMember } from './protocol.ts'
import {
  approveRoomAction,
  buildMembers,
  buildTimeline,
  handleFor,
  KEEP_EVENTS,
  listRooms,
  MAIN_THREAD,
  memberName,
  mentionsYou,
  mergeEvents,
  nameList,
  newId,
  readLog,
  replyingFromLog,
  replyingFromSessions,
  replyingLine,
  roomAttention,
  roomLastActive,
  roomPreview,
  roomsAvailable,
  sendRoomMessage,
  slug,
  splitMentions,
  whoIsReplying,
} from './rooms.ts'
import type { RpcClient } from './rpc.ts'

const members: RoomMember[] = [
  { member_id: 'm-hermes', profile: 'default', handle: 'hermes', display_name: 'Hermes' },
  { member_id: 'm-forge', profile: 'forge', handle: 'forge', display_name: 'Forge' },
]
const room = { members }

let seq = 0
const event = (kind: string, payload: Record<string, unknown>, actor: RoomEvent['actor'], ts = 1000): RoomEvent => ({ room_id: 'r', seq: ++seq, event_id: `e${seq}`, kind, actor, payload, created_at: ts })
const you = (text: string, ts = 1000) => event('message.user', { text, thread_id: MAIN_THREAD }, { kind: 'user', id: 'desktop' }, ts)
const bot = (memberId: string, text: string, ts = 1000) => event('message.member', { member_id: memberId, text, thread_id: MAIN_THREAD }, { kind: 'member', id: memberId, profile: memberId.replace('m-', '') }, ts)

function client(handler: (method: string, params: Record<string, unknown>) => unknown): RpcClient & { calls: { method: string; params: Record<string, unknown> }[] } {
  const calls: { method: string; params: Record<string, unknown> }[] = []

  return {
    calls,
    async request<T>(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })

      return (await handler(method, params)) as T
    },
  }
}

describe('ids and handles', () => {
  it('makes ids the server accepts', () => {
    const pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
    assert.match(newId('r'), pattern)
    assert.match(newId('e', 0, () => 0), pattern)
    assert.notEqual(newId('r', 1, () => 0.1), newId('r', 1, () => 0.2))
  })

  it('slugs a name into something typeable after @', () => {
    assert.equal(slug('Forge Scout!'), 'forge-scout')
    assert.equal(slug('  Ünïcode  '), 'unicode')
    assert.equal(slug('!!!'), '')
    assert.equal(slug('a'.repeat(40)).length, 24)
  })

  it('names a bot by its display name, then its profile, then a number', () => {
    assert.equal(handleFor('Forge', 'forge-x', new Set()), 'forge')
    assert.equal(handleFor('Forge', 'forge-x', new Set(['forge'])), 'forge-x')
    assert.equal(handleFor('Forge', 'forge', new Set(['forge'])), 'forge-2')
    assert.equal(handleFor('🙂', 'zz-bot', new Set()), 'zz-bot')
    assert.equal(handleFor('🙂', '🙂', new Set()), 'bot')
  })

  it('never hands out the words the server or a bot reads as something else', () => {
    assert.equal(handleFor('All', 'everyone', new Set()), 'bot')
    assert.equal(handleFor('You', 'user', new Set(['bot'])), 'bot-2')
  })

  it('builds a roster with stable member ids and unique handles', () => {
    const built = buildMembers([
      { profile: 'default', name: 'Orion' },
      { profile: 'orion', name: 'Orion' },
      { profile: 'zz-b', name: 'ZZ B' },
    ])
    assert.deepEqual(built.map(member => member.member_id), ['m-default', 'm-orion', 'm-zz-b'])
    assert.deepEqual(built.map(member => member.handle), ['orion', 'orion-2', 'zz-b'])
    assert.equal(new Set(built.map(member => member.handle)).size, 3)
    assert.equal(built[0]?.display_name, 'Orion')
  })

  it('lists names in words', () => {
    assert.equal(nameList(['Hermes', 'Forge', 'Scout']), 'Hermes, Forge and Scout')
    assert.equal(nameList(['Hermes', 'Forge']), 'Hermes and Forge')
    assert.equal(nameList(['Hermes']), 'Hermes')
  })
})

describe('merging the log', () => {
  const a = event('message.user', { text: 'a' }, { kind: 'user', id: 'desktop' })
  const b = event('message.user', { text: 'b' }, { kind: 'user', id: 'desktop' })
  const c = event('message.user', { text: 'c' }, { kind: 'user', id: 'desktop' })

  it('keeps events by seq, once, oldest first', () => {
    assert.deepEqual(mergeEvents([b], [c, a, b]).map(e => e.seq), [a.seq, b.seq, c.seq])
  })

  it('hands back the same array when nothing new arrived, so nothing re-renders', () => {
    const existing = [a, b]
    assert.equal(mergeEvents(existing, []), existing)
  })

  it('keeps only the newest ones', () => {
    assert.deepEqual(mergeEvents([a, b], [c], 2).map(e => e.seq), [b.seq, c.seq])
    assert.ok(KEEP_EVENTS >= 100)
  })
})

describe('mentions', () => {
  it('knows when a message is addressed to you', () => {
    assert.equal(mentionsYou('@you ok to restart?'), true)
    assert.equal(mentionsYou('ok to restart, @user?'), true)
    assert.equal(mentionsYou('Hey @YOU'), true)
    assert.equal(mentionsYou('mail@youtube.com'), false)
    assert.equal(mentionsYou('@your thing'), false)
    assert.equal(mentionsYou('no mention'), false)
  })

  it('splits a message so mentions can be drawn apart', () => {
    assert.deepEqual(splitMentions('@forge yes, 1 AM works. cc @unknown and @you.', ['forge', 'scout']), [
      { text: '@forge', mention: 'member' },
      { text: ' yes, 1 AM works. cc @unknown and ' },
      { text: '@you', mention: 'you' },
      { text: '.' },
    ])
  })

  it('leaves text with no mentions whole, and ignores @ inside words', () => {
    assert.deepEqual(splitMentions('plain', ['forge']), [{ text: 'plain' }])
    assert.deepEqual(splitMentions('me@forge.dev', ['forge']), [{ text: 'me@forge.dev' }])
  })

  it('matches handles without regard to case, and a handle that ends a sentence', () => {
    assert.deepEqual(splitMentions('Thanks @Forge.', ['forge']), [{ text: 'Thanks ' }, { text: '@Forge', mention: 'member' }, { text: '.' }])
  })
})

describe('the room as a conversation', () => {
  it('shows who said what, with a time label at the start and after a long gap', () => {
    const log = [you('@forge restart?', 1000), bot('m-forge', 'Sure.', 1010), bot('m-hermes', 'Agreed.', 1020), you('thanks', 1020 + 31 * 60)]
    const items = buildTimeline(room, log)
    assert.deepEqual(items.map(item => item.kind), ['time', 'user', 'member', 'member', 'time', 'user'])
    const member = items[2]
    assert.equal(member?.kind === 'member' && member.name, 'Forge')
    assert.equal(member?.kind === 'member' && member.profile, 'forge')
  })

  it('names a bot that is no longer in the roster from the event itself', () => {
    const items = buildTimeline(room, [event('message.member', { member_id: 'm-gone', text: 'hi' }, { kind: 'member', id: 'm-gone', profile: 'gone', display_name: 'Gone' })])
    const item = items.find(entry => entry.kind === 'member')
    assert.equal(item?.kind === 'member' && item.name, 'Gone')
    assert.equal(memberName(room, 'm-x'), 'm-x')
  })

  it('marks a bot message that addresses you', () => {
    const [, item] = buildTimeline(room, [bot('m-forge', '@you ok to restart the build server tonight?')])
    assert.equal(item?.kind === 'member' && item.atYou, true)
  })

  it('says so, in red, when a bot could not reply, and quietly when you stopped the room', () => {
    const items = buildTimeline(room, [
      event('turn.failed', { member_id: 'm-forge', error: 'model   unavailable\nretry later' }, { kind: 'gateway', id: 'g' }),
      event('room.stop_requested', { cancel_id: 'c' }, { kind: 'gateway', id: 'g' }),
    ])
    assert.deepEqual(items, [
      { kind: 'note', id: `e-${(items[0] as { id: string }).id.slice(2)}`, text: 'Forge couldn’t reply', detail: 'model unavailable retry later', tone: 'danger' },
      { kind: 'note', id: items[1]?.id, text: 'Stopped', tone: 'quiet' },
    ])
  })

  it('leaves out bookkeeping and empty messages', () => {
    const items = buildTimeline(room, [
      event('room.created', {}, { kind: 'system', id: 's' }),
      event('turn.settled', { member_id: 'm-forge', passed: true }, { kind: 'gateway', id: 'g' }),
      event('room.activity', { status: 'settled' }, { kind: 'gateway', id: 'g' }),
      bot('m-forge', '   '),
    ])
    assert.deepEqual(items, [])
  })
})

describe('what a room is waiting on you for', () => {
  const approval = { kind: 'approval', task_id: 't1', member_id: 'm-forge', execution_generation: 1, request_id: 'q1', approval: { command: 'rm -r x' } }
  const status = (pending_actions: unknown[]) => ({ running: true, working: false, blocked: false, counts: {}, pending_actions }) as never

  it('is waiting on an approval or a retry the server holds', () => {
    assert.equal(roomAttention(room, [], status([approval])).needsYou, true)
    assert.equal(roomAttention(room, [], status([{ kind: 'retry', task_id: 't2' }])).needsYou, true)
    assert.equal(roomAttention(room, [], status([{ kind: 'something-new', task_id: 't3' }])).needsYou, false)
    assert.equal(roomAttention(room, [], null).needsYou, false)
  })

  it('holds back a retry while the server is still checking on the cut-off reply, and offers it once it gives up', () => {
    const retry = { kind: 'retry', task_id: 't2' }
    const withCounts = (counts: Record<string, number>) => ({ running: true, working: false, blocked: true, counts, pending_actions: [retry] }) as never

    assert.equal(roomAttention(room, [], withCounts({ indeterminate: 1 })).needsYou, false)
    assert.equal(roomAttention(room, [], withCounts({ deferred: 1 })).needsYou, true)
    assert.equal(roomAttention(room, [], withCounts({ indeterminate: 1, deferred: 1 })).actions.length, 1)
  })

  it('names the bot whose reply a retry would run again, from the turn events', () => {
    const deferred = event('turn.deferred', { member_id: 'm-forge', task_id: 't2', reason: 'member_unavailable', execution_generation: 1 }, { kind: 'gateway', id: 'g' })
    const [action] = roomAttention(room, [you('go'), deferred], status([{ kind: 'retry', task_id: 't2' }])).actions

    assert.equal(action?.member_id, 'm-forge')
  })

  it('is waiting on you when the latest bot message addresses you', () => {
    const attention = roomAttention(room, [you('go'), bot('m-forge', '@you ok to restart?')], status([]))
    assert.equal(attention.needsYou, true)
    assert.deepEqual(attention.mention, { memberId: 'm-forge', name: 'Forge', text: '@you ok to restart?' })
  })

  it('stops waiting once you have answered, or a later bot message moved on', () => {
    assert.equal(roomAttention(room, [bot('m-forge', '@you ok?'), you('yes')], status([])).needsYou, false)
    assert.equal(roomAttention(room, [bot('m-forge', 'fine'), bot('m-hermes', 'done')], status([])).needsYou, false)
  })
})

describe('the Home line', () => {
  it('shows the last message with who said it', () => {
    assert.equal(roomPreview(room, [you('hi'), bot('m-forge', 'Scheduled.\nSee you at 1')], false), 'Forge: Scheduled. See you at 1')
    assert.equal(roomPreview(room, [bot('m-forge', 'ok'), you('thanks')], false), 'You: thanks')
  })

  it('says what the room is doing when there is nothing to show, or the bots are working', () => {
    assert.equal(roomPreview(room, [], false), 'No messages yet')
    assert.equal(roomPreview(room, [you('hi')], true), 'Working…')
  })

  it('dates a room by its newest event', () => {
    assert.equal(roomLastActive({ updated_at: 100 }, []), 100)
    assert.equal(roomLastActive({ updated_at: 100 }, [you('x', 500)]), 500)
  })
})

describe('calls', () => {
  it('asks whether the worker is up, and says no when the server has no rooms', async () => {
    assert.equal(await roomsAvailable(client(() => ({ protocol_version: 2, driver: true, max_log_limit: 500 }))), true)
    assert.equal(await roomsAvailable(client(() => ({ protocol_version: 2, driver: false, max_log_limit: 500 }))), false)
    assert.equal(await roomsAvailable(client(() => { throw new Error('method not found') })), false)
  })

  it('reads every page of rooms', async () => {
    const c = client((_m, params) => ((params.offset as number) === 0 ? { rooms: [{ room_id: 'a' }], next_offset: 1 } : { rooms: [{ room_id: 'b' }], next_offset: null }))
    assert.deepEqual((await listRooms(c)).map(r => r.room_id), ['a', 'b'])
  })

  it('reads the log from where it left off, through several pages, and says if more is left', async () => {
    const pages = [
      { events: [{ seq: 4 }], cursor: 4, latest_seq: 6, has_more: true },
      { events: [{ seq: 5 }, { seq: 6 }], cursor: 6, latest_seq: 6, has_more: false },
    ]
    const c = client(() => pages.shift())
    const result = await readLog(c, 'r1', 3)
    assert.deepEqual(result.events.map(e => e.seq), [4, 5, 6])
    assert.equal(result.cursor, 6)
    assert.equal(result.has_more, false)
    assert.deepEqual(c.calls.map(call => call.params.since_seq), [3, 4])
  })

  it('sends your message into the one thread, with your own retry key', async () => {
    const c = client(() => ({ event: { seq: 9 }, client_event_id: 'e-1', accepted: true }))
    const sent = await sendRoomMessage(c, 'r1', 'hello', 'e-1')
    assert.equal(sent.seq, 9)
    assert.deepEqual(c.calls[0], { method: 'groups.send', params: { room_id: 'r1', event_id: 'e-1', payload: { text: 'hello', thread_id: MAIN_THREAD } } })
  })

  it('answers an approval with exactly the ids the server gave', async () => {
    const c = client(() => ({ approved: true }))
    await approveRoomAction(c, 'r1', { kind: 'approval', task_id: 't1', member_id: 'm-forge', execution_generation: 2, request_id: 'q9' }, 'once')
    assert.deepEqual(c.calls[0]?.params, { room_id: 'r1', member_id: 'm-forge', task_id: 't1', execution_generation: 2, choice: 'once', request_id: 'q9' })
  })
})

describe('who is replying in a room', () => {
  const settled = (memberId: string) => event('turn.settled', { member_id: memberId, passed: false }, { kind: 'gateway', id: 'g' })
  const working = { running: true, working: true, blocked: false, counts: { running: 1 }, pending_actions: [] }
  const sessions = { 'm-hermes': ['s-hermes'], 'm-forge': ['s-forge'] }

  it('reads it from the live sessions: a member whose room session is working', () => {
    const live = [
      { id: 'live-1', session_key: 's-forge', status: 'working' as const },
      { id: 'live-2', session_key: 's-hermes', status: 'idle' as const },
    ]
    assert.deepEqual(replyingFromSessions(room, sessions, live), ['m-forge'])
    assert.deepEqual(replyingFromSessions(room, { 'm-forge': ['live-1'] }, live), ['m-forge'], 'by the live id too')
  })

  it('from the log: everyone your message asked, or only the bots it @mentions, until each finishes a turn', () => {
    assert.deepEqual(replyingFromLog(room, [you('hi all')]), ['m-hermes', 'm-forge'])
    assert.deepEqual(replyingFromLog(room, [you('@forge check it')]), ['m-forge'])
    assert.deepEqual(replyingFromLog(room, [you('hi all'), bot('m-hermes', 'hello'), settled('m-hermes')]), ['m-forge'])
    assert.deepEqual(replyingFromLog(room, [you('@everyone report')]), ['m-hermes', 'm-forge'])
  })

  it('a bot @mentioning another asks it for the next round', () => {
    const events = [you('@hermes plan it'), bot('m-hermes', '@forge can you build this?'), settled('m-hermes')]
    assert.deepEqual(replyingFromLog(room, events), ['m-forge'])
    assert.deepEqual(replyingFromLog(room, [...events, bot('m-forge', 'done'), settled('m-forge')]), [])
  })

  it('but not one that has already spoken: bots @mentioning each other after both answered ask nobody again', () => {
    const events = [you('each of you, one sentence'), bot('m-forge', 'done, @hermes'), settled('m-forge'), bot('m-hermes', 'me too, @forge'), settled('m-hermes')]
    assert.deepEqual(replyingFromLog(room, events), [])
  })

  it('names nobody before you have said anything', () => {
    assert.deepEqual(replyingFromLog(room, [bot('m-forge', 'hi')]), [])
  })

  it('prefers the live sessions, falls back to the log, and says nothing while the room is idle', () => {
    const live = [{ id: 'live-1', session_key: 's-hermes', status: 'working' as const }]
    assert.deepEqual(whoIsReplying(room, [you('hi all')], working as never, sessions, live), ['m-hermes'])
    assert.deepEqual(whoIsReplying(room, [you('@forge go')], working as never, {}, live), ['m-forge'])
    assert.deepEqual(whoIsReplying(room, [you('hi all')], { ...working, working: false } as never, sessions, live), [])
  })

  it('words it as working when it cannot tell more', () => {
    assert.equal(replyingLine(room, ['m-forge']), 'Forge is working…')
    assert.equal(replyingLine(room, ['m-hermes', 'm-forge']), 'Hermes and Forge are working…')
    assert.equal(replyingLine(room, []), 'Working…')
  })

  it('says what each bot is doing from the server’s activity', () => {
    const at = (phase: string, tool: string | null = null) => ({ phase, tool, since: 100 })
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('tool', 'terminal') }), 'Forge is running a command…')
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('tool', 'web_search') }), 'Forge is searching the web…')
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('tool', 'mcp__bank__balance') }), 'Forge is using bank…')
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('tool', 'odd_tool') }), 'Forge is using odd tool…')
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('thinking') }), 'Forge is thinking…')
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('writing') }), 'Forge is writing…')
    assert.equal(replyingLine(room, ['m-forge'], { 'm-forge': at('approval') }), 'Forge needs your OK')
    assert.equal(replyingLine(room, ['m-hermes', 'm-forge'], { 'm-hermes': at('writing'), 'm-forge': at('writing') }), 'Hermes and Forge are writing…')
    assert.equal(replyingLine(room, ['m-hermes', 'm-forge'], { 'm-hermes': at('writing'), 'm-forge': at('tool', 'terminal') }), 'Hermes and Forge are working…')
  })
})
