import { describe, expect, it } from 'vitest'
import { mobileNotesView } from './mobile-tag-view'

const base = {
  tagKey: 'project',
  typed: true,
  boardAvailable: true,
  globalView: 'list' as const,
  modes: {},
}

describe('mobileNotesView', () => {
  it('keeps the global list/grid choice off a typed tag', () => {
    expect(mobileNotesView({ ...base, tagKey: null, globalView: 'grid' })).toBe('grid')
    expect(mobileNotesView({ ...base, typed: false, modes: { project: 'board' } })).toBe('list')
  })

  it('reads the per-tag layout the desktop page writes', () => {
    expect(mobileNotesView({ ...base, modes: { project: 'board' } })).toBe('board')
    expect(mobileNotesView({ ...base, modes: { project: 'grid' } })).toBe('grid')
  })

  it('falls back to the row list for views the phone has no room for', () => {
    expect(mobileNotesView({ ...base, modes: { project: 'table' } })).toBe('list')
    expect(mobileNotesView({ ...base, modes: { project: 'calendar' } })).toBe('list')
    expect(mobileNotesView({ ...base, boardAvailable: false, modes: { project: 'board' } })).toBe(
      'list',
    )
  })

  it('uses the global choice until the tag has its own', () => {
    expect(mobileNotesView({ ...base, globalView: 'grid' })).toBe('grid')
  })
})
