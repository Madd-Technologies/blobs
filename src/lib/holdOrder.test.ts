import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { holdOrder } from './holdOrder.ts'

const id = (value: string) => value

describe('holdOrder', () => {
  it('is the list as it is when nothing is held', () => {
    assert.deepEqual(holdOrder(['hydra', 'leto'], id, null), ['hydra', 'leto'])
  })

  it('keeps rows where they were while held, though their activity moved them', () => {
    assert.deepEqual(holdOrder(['hydra', 'leto', 'noah'], id, ['leto', 'hydra', 'noah']), ['leto', 'hydra', 'noah'])
  })

  it('puts a new row after the held ones and leaves out one that went away', () => {
    assert.deepEqual(holdOrder(['pepper', 'leto', 'hydra'], id, ['leto', 'noah', 'hydra']), ['leto', 'hydra', 'pepper'])
  })
})
