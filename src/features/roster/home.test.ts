import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { homeList } from './home.ts'

const bot = (name: string, at: number, pinned = false) => ({ name, at, pinned })
const room = (name: string, at: number) => ({ name, at })

describe('Home list', () => {
  it('keeps pinned bots first, then bots and rooms together by latest activity', () => {
    const list = homeList([bot('orion', 50, true), bot('juniper', 10, true), bot('scout', 300), bot('ember', 100)], [room('harbor', 200), room('server', 5)], b => b.at, r => r.at)

    assert.deepEqual(
      list.map(item => `${item.kind}:${item.view.name}`),
      ['bot:orion', 'bot:juniper', 'bot:scout', 'room:harbor', 'bot:ember', 'room:server'],
    )
  })

  it('orders pinned bots the same way, so background work does not shuffle them either (the roster’s order only breaks ties)', () => {
    const list = homeList([bot('orion', 50, true), bot('juniper', 90, true), bot('scout', 50, true)], [] as ReturnType<typeof room>[], b => b.at, r => r.at)

    assert.deepEqual(list.map(item => item.view.name), ['juniper', 'orion', 'scout'])
  })

  it('puts the bot first when a bot and a room are as active as each other', () => {
    const list = homeList([bot('a', 7)], [room('r', 7)], b => b.at, r => r.at)

    assert.deepEqual(list.map(item => item.kind), ['bot', 'room'])
  })
})
