import { describe, expect, it } from 'vitest'
import {
  isKoreManagedNote,
  isKoreManagedNotePath,
  isValidKoreNoteId,
} from './note-management'

const VALID_ID = '01hv3xq7c2dm8k4t9w5e6r1n98'

describe('Reflect-managed notes', () => {
  it('requires a direct notes/*.md path and valid ULID frontmatter', () => {
    const source = `---\nid: ${VALID_ID}\n---\n# Managed\n`
    expect(isKoreManagedNote('notes/managed.md', source)).toBe(true)
    expect(isKoreManagedNote('notes/nested/managed.md', source)).toBe(false)
    expect(isKoreManagedNote('Projects/managed.md', source)).toBe(false)
  })

  it('keeps direct adopted notes without a valid Reflect id unmanaged', () => {
    expect(isKoreManagedNote('notes/adopted.md', '# Adopted\n')).toBe(false)
    expect(isKoreManagedNote('notes/adopted.md', '---\nid: legacy-id\n---\n# Adopted\n')).toBe(
      false,
    )
  })

  it('validates canonical ULIDs case-insensitively and rejects overflow', () => {
    expect(isValidKoreNoteId(VALID_ID)).toBe(true)
    expect(isValidKoreNoteId(VALID_ID.toUpperCase())).toBe(true)
    expect(isValidKoreNoteId(`8${VALID_ID.slice(1)}`)).toBe(false)
    expect(isValidKoreNoteId('not-a-ulid')).toBe(false)
    expect(isValidKoreNoteId(null)).toBe(false)
  })

  it('recognizes only visible direct managed-note paths', () => {
    expect(isKoreManagedNotePath('notes/managed.md')).toBe(true)
    expect(isKoreManagedNotePath('notes/.hidden.md')).toBe(false)
    expect(isKoreManagedNotePath('notes/nested/managed.md')).toBe(false)
    expect(isKoreManagedNotePath('notes/managed.MD')).toBe(false)
  })

  it('matches the notes directory case-insensitively', () => {
    // On a case-insensitive filesystem a pre-existing `Notes/` folder
    // captures Kore's own writes; the walker then reports that casing and
    // Kore-created notes must not silently lose slug management.
    expect(isKoreManagedNotePath('Notes/managed.md')).toBe(true)
    // Path casing alone claims nothing: without a valid ULID id the note
    // stays adopted.
    expect(isKoreManagedNote('Notes/adopted.md', '# Adopted\n')).toBe(false)
    const source = `---\nid: ${VALID_ID}\n---\n# Managed\n`
    expect(isKoreManagedNote('Notes/managed.md', source)).toBe(true)
  })
})
