import { describe, expect, it } from 'vitest'
import { clearQueuedGraphRole, queueGraphRole, takeQueuedGraphRole } from './graph-role'

describe('queueGraphRole', () => {
  it('hands the chooser role to the next open exactly once', () => {
    expect(takeQueuedGraphRole()).toBe(null)
    queueGraphRole('company')
    expect(takeQueuedGraphRole()).toBe('company')
    expect(takeQueuedGraphRole()).toBe(null)
  })

  it('forgets a queued role that never landed', () => {
    queueGraphRole('company')
    clearQueuedGraphRole()
    expect(takeQueuedGraphRole()).toBe(null)
  })
})
