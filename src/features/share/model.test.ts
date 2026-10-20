import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { TaildropStatus, TaildropTarget } from '../../lib/hermes/taildrop.ts'
import { deviceLine, deviceRows, progressLabel, sendFailure, sentToast, sizeLabel, splitStale } from './model.ts'

const target = (patch: Partial<TaildropTarget>): TaildropTarget => ({ name: 'device', ip: '100.64.0.10', online: true, detail: null, you: false, ...patch })
const status = (targets: TaildropTarget[]): TaildropStatus => ({ supported: true, why: null, targets, you: { name: 'pixel-9', os: 'android', ip: '100.64.0.13' }, setup: null, max_bytes: 2 ** 31, sending: [] })

describe('the device sheet', () => {
  it('lists this phone first, the device used last next, then online before offline', () => {
    const rows = deviceRows(
      status([
        target({ name: 'workstation', ip: '100.64.0.14', online: false, detail: 'offline; last seen 3h12m0s ago' }),
        target({ name: 'macbook', ip: '100.64.0.15' }),
        target({ name: 'desktop', ip: '100.64.0.16' }),
        target({ name: 'pixel-9', ip: '100.64.0.13', you: true }),
      ]),
      'desktop',
    )
    assert.deepEqual(
      rows.map(row => [row.title, row.line, row.disabled]),
      [
        ['This phone', 'pixel-9', false],
        ['desktop', 'Last used', false],
        ['macbook', '', false],
        ['workstation', 'Offline · seen 3 h ago', true],
      ],
    )
    assert.equal(rows[0]?.icon, 'smartphone')
  })

  it('folds away devices offline for over a week, keeping this phone and the last one used', () => {
    const rows = deviceRows(
      status([
        target({ name: 'pixel-9', you: true, online: false, detail: 'offline; last seen 400h0m0s ago' }),
        target({ name: 'macbook', ip: '100.64.0.15' }),
        target({ name: 'laptop', ip: '100.64.0.16', online: false, detail: 'offline; last seen 30h0m0s ago' }),
        target({ name: 'old-nas', ip: '100.64.0.17', online: false, detail: 'offline; last seen 3600h0m0s ago' }),
        target({ name: 'kiosk', ip: '100.64.0.18', online: false, detail: 'offline; last seen 900h0m0s ago' }),
      ]),
      'kiosk',
    )
    const { shown, stale } = splitStale(rows)
    assert.deepEqual(shown.map(row => row.target.name), ['pixel-9', 'kiosk', 'macbook', 'laptop'])
    assert.deepEqual(stale.map(row => row.target.name), ['old-nas'])
  })

  it('reads what the CLI says about a device', () => {
    assert.equal(deviceLine(target({ online: false, detail: 'offline; last seen 45m10s ago' })), 'Offline · seen 45 min ago')
    assert.equal(deviceLine(target({ online: false, detail: null })), 'Offline')
    assert.equal(deviceLine(target({ detail: 'no file sharing target' })), 'That device isn’t accepting files')
  })
})

describe('the header line', () => {
  it('counts in one unit', () => {
    assert.equal(progressLabel(12 * 1024 * 1024, 34 * 1024 * 1024), '12 of 34 MB')
    assert.equal(progressLabel(1.5 * 1024 * 1024, 4 * 1024 * 1024), '1.5 of 4.0 MB')
    assert.equal(progressLabel(300 * 1024, 900 * 1024), '300 of 900 KB')
    assert.equal(progressLabel(12 * 1024 * 1024, null), '12 MB')
    assert.equal(sizeLabel(34 * 1024 * 1024), '34 MB')
  })

  it('says a failed send quietly', () => {
    assert.equal(sendFailure('macbook', 'macbook is not replying; trying anyway\nfailed'), 'macbook went offline')
    assert.equal(sendFailure('macbook', 'Access denied: file access denied'), 'the server needs one setup step')
    assert.equal(sendFailure('macbook', null), 'it stopped part way')
  })

  it('says where the file arrived', () => {
    assert.equal(sentToast(target({ name: 'macbook' })), 'Sent to macbook · it’s in Tailscale’s notification there')
    assert.equal(sentToast(target({ you: true })), 'Sent to this phone · it’s in Tailscale’s notification')
  })
})
