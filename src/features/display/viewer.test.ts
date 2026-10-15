import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CLOSE, decideAfterClose, displayWsUrl, parseViewerMessage, RECONNECT_DELAYS_MS } from './viewer.ts'

describe('displayWsUrl', () => {
  it('turns the server address into the websocket route with the ticket', () => {
    assert.equal(displayWsUrl('http://100.64.0.1:9119', '/api/display/ws', 'abc'), 'ws://100.64.0.1:9119/api/display/ws?display_ticket=abc')
    assert.equal(displayWsUrl('https://hermes.example.ts.net/', '/api/display/ws', 'abc'), 'wss://hermes.example.ts.net/api/display/ws?display_ticket=abc')
  })

  it('escapes the ticket and tolerates a path with no leading slash', () => {
    assert.equal(displayWsUrl('http://h:1', 'api/display/ws', 'a b&c='), 'ws://h:1/api/display/ws?display_ticket=a%20b%26c%3D')
  })

  it('keeps a path prefix the server sits behind', () => {
    assert.equal(displayWsUrl('https://host/hermes', '/api/display/ws', 't'), 'wss://host/hermes/api/display/ws?display_ticket=t')
  })
})

describe('parseViewerMessage', () => {
  it('reads each message the page posts', () => {
    assert.deepEqual(parseViewerMessage('{"type":"ready"}'), { type: 'ready' })
    assert.deepEqual(parseViewerMessage('{"type":"connected"}'), { type: 'connected' })
    assert.deepEqual(parseViewerMessage('{"type":"desktopname","name":"bot:1"}'), { type: 'desktopname', name: 'bot:1' })
    assert.deepEqual(parseViewerMessage('{"type":"disconnected","clean":false,"code":4000,"reason":"control-taken"}'), { type: 'disconnected', clean: false, code: 4000, reason: 'control-taken' })
    assert.deepEqual(parseViewerMessage('{"type":"error","message":"boom"}'), { type: 'error', message: 'boom' })
  })

  it('a disconnect with no code stays codeless (noVNC itself never reports one)', () => {
    assert.deepEqual(parseViewerMessage('{"type":"disconnected","clean":true}'), { type: 'disconnected', clean: true, code: undefined, reason: undefined })
  })

  it('ignores anything that is not ours', () => {
    assert.equal(parseViewerMessage('not json'), null)
    assert.equal(parseViewerMessage('{"type":"somebody-elses"}'), null)
    assert.equal(parseViewerMessage('42'), null)
  })
})

describe('what to do when the connection ends', () => {
  const at = (attempts = 0) => ({ attempts })

  it('control taken: come back at once as a watcher, and say why', () => {
    assert.deepEqual(decideAfterClose({ code: CLOSE.ControlTaken }, at(2)), { kind: 'reconnect', delayMs: 0, viewOnly: true, notice: 'Someone else took control.' })
  })

  it('screen gone: stop dialling and re-read the status', () => {
    assert.equal(decideAfterClose({ code: CLOSE.ScreenGone }, at()).kind, 'gone')
  })

  it('a spent ticket asks for another at once, a few times, then gives up', () => {
    assert.deepEqual(decideAfterClose({ code: CLOSE.BadTicket }, at(0)), { kind: 'reconnect', delayMs: 0 })
    assert.deepEqual(decideAfterClose({ code: CLOSE.BadTicket }, at(2)), { kind: 'reconnect', delayMs: 0 })
    assert.equal(decideAfterClose({ code: CLOSE.BadTicket }, at(3)).kind, 'fail')
  })

  it('a refusal by the server\'s policy, or a protocol error, is not retried', () => {
    assert.equal(decideAfterClose({ code: CLOSE.NotAllowed }, at()).kind, 'fail')
    assert.equal(decideAfterClose({ code: CLOSE.Protocol }, at()).kind, 'fail')
  })

  it('a dropped link redials with a growing delay, then gives up', () => {
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length; attempt++) {
      assert.deepEqual(decideAfterClose({ code: 1006 }, at(attempt)), { kind: 'reconnect', delayMs: RECONNECT_DELAYS_MS[attempt] })
    }

    assert.deepEqual(decideAfterClose({ code: 1006 }, at(RECONNECT_DELAYS_MS.length)), { kind: 'fail', message: 'Lost the connection to the screen.' })
  })

  it('no code at all is treated as a dropped link', () => {
    assert.equal(decideAfterClose({ clean: false }, at()).kind, 'reconnect')
  })
})
