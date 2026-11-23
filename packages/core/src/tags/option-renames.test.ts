import { describe, expect, it } from 'vitest'
import { optionRenameMap, optionUseCounts, renameOptionValue } from './option-renames'

describe('renameOptionValue', () => {
  const renames = optionRenameMap([
    { from: 'Todo', to: 'To do' },
    { from: 'Active', to: 'Doing' },
  ])

  it('renames a single option and skips untouched values', () => {
    expect(renameOptionValue('Todo', renames)).toBe('To do')
    expect(renameOptionValue('Done', renames)).toBeUndefined()
  })

  it('renames inside a multi-select list, keeping order and dropping duplicates', () => {
    expect(renameOptionValue(['Done', 'Active'], renames)).toEqual(['Done', 'Doing'])
    expect(renameOptionValue(['Doing', 'Active'], renames)).toEqual(['Doing'])
    expect(renameOptionValue(['Done'], renames)).toBeUndefined()
  })

  it('swaps two names instead of collapsing them', () => {
    const swap = optionRenameMap([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ])
    expect(renameOptionValue('A', swap)).toBe('B')
    expect(renameOptionValue('B', swap)).toBe('A')
    expect(renameOptionValue(['A', 'B'], swap)).toEqual(['B', 'A'])
  })

  it('takes a deleted option off the notes and merges one into another', () => {
    const changes = optionRenameMap([
      { from: 'in pausa', to: 'paused' },
      { from: 'Old', to: null },
    ])
    expect(renameOptionValue('in pausa', changes)).toBe('paused')
    expect(renameOptionValue('Old', changes)).toBeNull()
    expect(renameOptionValue(['Old', 'in pausa', 'paused'], changes)).toEqual(['paused'])
    expect(renameOptionValue(['Old'], changes)).toBeNull()
  })

  it('leaves other shapes alone', () => {
    expect(renameOptionValue(3, renames)).toBeUndefined()
    expect(renameOptionValue(null, renames)).toBeUndefined()
  })

  it('counts the notes using each option', () => {
    const counts = optionUseCounts(['paused', ['paused', 'active'], 'active', 'active', 3])
    expect(counts.get('paused')).toBe(2)
    expect(counts.get('active')).toBe(3)
    expect(counts.get('done')).toBeUndefined()
  })
})
