import { describe, expect, it } from 'vitest'
import {
  isInExcludedFolder,
  semanticExcludedFolders,
  withSemanticExcludedFolders,
} from './exclusions'

describe('semanticExcludedFolders', () => {
  it('reads none from a vault that never set them', () => {
    expect(semanticExcludedFolders({})).toEqual([])
  })

  it('reads the stored folders normalized, deduplicated and sorted', () => {
    const vault = { semantic: { excludeFolders: ['/Input/Granola/', 'Archive', ' Archive ', ''] } }
    expect(semanticExcludedFolders(vault)).toEqual(['Archive', 'Input/Granola'])
  })

  it('reads none from a malformed entry instead of failing the vault', () => {
    expect(semanticExcludedFolders({ semantic: 'everything' })).toEqual([])
    expect(semanticExcludedFolders({ semantic: { excludeFolders: 'Input' } })).toEqual([])
  })
})

describe('withSemanticExcludedFolders', () => {
  it('replaces the list and keeps every other key', () => {
    const vault = {
      integrations: { granola: { folder: 'Input/Granola' } },
      semantic: { excludeFolders: ['Old'], futureKey: true },
    }
    expect(withSemanticExcludedFolders(vault, ['Input/Granola/'])).toEqual({
      integrations: { granola: { folder: 'Input/Granola' } },
      semantic: { excludeFolders: ['Input/Granola'], futureKey: true },
    })
  })
})

describe('isInExcludedFolder', () => {
  it('matches notes in the folder and below it', () => {
    expect(isInExcludedFolder('Input/Granola/a.md', ['Input/Granola'])).toBe(true)
    expect(isInExcludedFolder('Input/Granola/2026/a.md', ['Input/Granola'])).toBe(true)
  })

  it('does not match a sibling folder that shares the prefix, or a note of that name', () => {
    expect(isInExcludedFolder('Input/Granola Notes/a.md', ['Input/Granola'])).toBe(false)
    expect(isInExcludedFolder('Input/Granola.md', ['Input/Granola'])).toBe(false)
    expect(isInExcludedFolder('Input/a.md', [])).toBe(false)
  })
})
