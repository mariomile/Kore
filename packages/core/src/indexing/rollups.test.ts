import { describe, expect, it, vi } from 'vitest'
import { attachReverseRelations, attachRollups } from './rollups'
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

describe('attachReverseRelations', () => {
  it('lists the linking collection’s rows on the row they point at', async () => {
    const type: TagType = {
      properties: [
        {
          name: 'People',
          key: 'people',
          type: 'reverse',
          reverse: { tag: 'person', property: 'company' },
        },
      ],
    }
    const resolveWikiTarget = vi.fn(async (target: string) => ({
      kind: 'resolved' as const,
      ref: target === 'Kore' ? 'notes/kore.md' : 'notes/elsewhere.md',
    }))
    const listCollection = vi.fn(async () => [
      entry('notes/sarah.md', { company: cell('[[Kore]]', 'string') }),
      entry('notes/james.md', { company: cell('[[Acme]]', 'string') }),
      entry('notes/lee.md', {}),
    ])

    const rows = await attachReverseRelations(
      [entry('notes/kore.md', {}), entry('notes/acme2.md', {})],
      type,
      { resolveWikiTarget, listCollection },
    )

    // Sarah links here; James resolves elsewhere; Lee links nothing.
    expect(rows[0]?.properties['people']).toEqual({
      value: JSON.stringify(['[[notes/sarah.md]]']),
      valueType: 'list',
      valueNumber: 1,
    })
    // No linkers: the key stays absent, so the footer never counts it filled.
    expect(rows[1]?.properties['people']).toBeUndefined()
    expect(listCollection).toHaveBeenCalledWith('person', null)
  })
})
