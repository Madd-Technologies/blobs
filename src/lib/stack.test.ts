import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { chatInStack } from './stack.ts'

describe('chatInStack', () => {
  const routes = [{ name: 'index' }, { name: 'bot/[profile]/index', params: { profile: 'juniper' } }, { name: 'bot/[profile]/chats', params: { profile: 'juniper' } }]

  it('finds the bot’s chat anywhere below', () => {
    assert.equal(chatInStack(routes, 'juniper'), true)
  })

  it('another bot’s chat, or another screen of this bot, is not it', () => {
    assert.equal(chatInStack(routes, 'orion'), false)
    assert.equal(chatInStack([{ name: 'index' }, { name: 'bot/[profile]/dashboard', params: { profile: 'juniper' } }], 'juniper'), false)
  })

  it('no stack is no chat', () => {
    assert.equal(chatInStack(undefined, 'juniper'), false)
  })
})
