import { describe, expect, it } from 'vitest'
import { optionRenameMap, renameOptionValue } from './option-renames'

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

  it('leaves other shapes alone', () => {
    expect(renameOptionValue(3, renames)).toBeUndefined()
    expect(renameOptionValue(null, renames)).toBeUndefined()
  })
})
