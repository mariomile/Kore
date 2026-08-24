import { describe, expect, it, vi } from 'vitest'
import { attachRollups } from './rollups'
import type { CollectionEntry, CollectionValue } from './collections'
import type { TagType } from '../tags'

function entry(path: string, properties: Record<string, CollectionValue>): CollectionEntry {
  return { path, title: path, mtime: 0, isPinned: false, properties }
}

function cell(
  value: string,
  valueType: CollectionValue['valueType'],
  valueNumber: number | null = null,
): CollectionValue {
  return { value, valueType, valueNumber }
}

describe('attachRollups', () => {
  it('fills a view-only rollup from related notes and never invents a write', async () => {
    const type: TagType = {
      properties: [
        { name: 'Author', key: 'author', type: 'relation' },
        {
          name: 'Author rating',
          key: 'author-rating',
          type: 'rollup',
          rollup: { relation: 'author', property: 'rating', aggregation: 'original' },
        },
      ],
    }
    const resolveWikiTarget = vi.fn(async () => ({
      kind: 'resolved' as const,
      ref: 'notes/le-guin.md',
    }))
    const getNoteProperties = vi.fn(async () => ({
      rating: cell('5', 'number', 5),
    }))

    const rows = await attachRollups(
      [entry('notes/dune.md', { author: cell('[[Le Guin]]', 'string') })],
      type,
      { resolveWikiTarget: resolveWikiTarget, getNoteProperties: getNoteProperties },
    )

    expect(rows[0]?.properties['author-rating']).toEqual({
      value: '5',
      valueType: 'number',
      valueNumber: 5,
    })
    expect(getNoteProperties).toHaveBeenCalledWith('notes/le-guin.md')
  })
})
