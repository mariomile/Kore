import { describe, expect, it } from 'vitest'
import { libraryFileTitle } from './title'

describe('libraryFileTitle', () => {
  it('uses the file name without its extension', () => {
    expect(libraryFileTitle('agents/code-reviewer.md')).toBe('code-reviewer')
  })

  it('names a fixed-name file after its folder', () => {
    expect(libraryFileTitle('skills/review/SKILL.md')).toBe('review')
    expect(libraryFileTitle('plugins/x/README.md')).toBe('x')
  })

  it('keeps a fixed name at the top of the folder', () => {
    expect(libraryFileTitle('CLAUDE.md')).toBe('CLAUDE')
  })
})
