import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { holdOrder } from './holdOrder.ts'

const id = (value: string) => value

describe('holdOrder', () => {
  it('is the list as it is when nothing is held', () => {
    assert.deepEqual(holdOrder(['juniper', 'orion'], id, null), ['juniper', 'orion'])
  })

  it('keeps rows where they were while held, though their activity moved them', () => {
    assert.deepEqual(holdOrder(['juniper', 'orion', 'harbor'], id, ['orion', 'juniper', 'harbor']), ['orion', 'juniper', 'harbor'])
  })

  it('puts a new row after the held ones and leaves out one that went away', () => {
    assert.deepEqual(holdOrder(['concierge', 'orion', 'juniper'], id, ['orion', 'harbor', 'juniper']), ['orion', 'juniper', 'concierge'])
  })
})
