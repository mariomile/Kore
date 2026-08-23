import { describe, expect, it } from 'vitest'
import { frontmatterSchema } from '../markdown'
import { extractNoteProperties } from './properties'

function extract(raw: Record<string, unknown>) {
  return extractNoteProperties(frontmatterSchema.parse(raw))
}

describe('extractNoteProperties', () => {
  it('indexes scalar values with their canonical string form', () => {
    expect(extract({ author: 'Le Guin', rating: 4.5, read: true })).toEqual([
      { key: 'author', value: 'Le Guin', valueType: 'string', valueNumber: null },
      { key: 'rating', value: '4.5', valueType: 'number', valueNumber: 4.5 },
      { key: 'read', value: 'true', valueType: 'boolean', valueNumber: null },
    ])
  })

  it('indexes scalar arrays as JSON list values', () => {
    expect(extract({ topics: ['ai', 'product'] })).toEqual([
      { key: 'topics', value: '["ai","product"]', valueType: 'list', valueNumber: null },
    ])
  })

  it('skips reserved keys, empty lists, and non-scalar shapes', () => {
    expect(
      extract({
        private: true,
        pinned: 3,
        aliases: ['x'],
        lore: 'tag',
        properties: [{ name: 'A', key: 'a', type: 'text' }],
        empty: [],
        nested: [['a']],
        object: { a: 1 },
        nothing: null,
        infinite: Infinity,
      }),
    ).toEqual([])
  })

  it('keeps date-shaped strings as strings — typing is display-time', () => {
    expect(extract({ finished: '2026-01-15' })).toEqual([
      { key: 'finished', value: '2026-01-15', valueType: 'string', valueNumber: null },
    ])
  })
})
