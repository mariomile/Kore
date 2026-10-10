import { describe, expect, it } from 'vitest'
import { connectorFileStem } from './markdown'

describe('connectorFileStem', () => {
  it('keeps a readable title and drops unsafe characters', () => {
    expect(connectorFileStem('  .Deep: Work / Notes?  ', 'id')).toBe('Deep Work Notes')
  })

  it('cleans the fallback too, so a remote id cannot carry a path', () => {
    expect(connectorFileStem('///', '../agents/skills/pwned')).toBe('agents skills pwned')
    expect(connectorFileStem('', '/..//')).toBe('Untitled')
  })
})
