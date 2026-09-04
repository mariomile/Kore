import { describe, expect, it, vi } from 'vitest'
import {
  attachFormulaColumns,
  attachReverseRelations,
  attachRollups,
  attachTimestampColumns,
} from './rollups'
import { effectiveCollectionSorts, UPDATED_SORT_KEY } from './collections'
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
    expect(listCollection).toHaveBeenCalledWith('person', [])
  })
})

describe('attachTimestampColumns', () => {
  const type: TagType = {
    properties: [
      { name: 'Touched', key: 'touched', type: 'updated' },
      { name: 'Due', key: 'due', type: 'date' },
    ],
  }

  it('fills updated cells from the row mtime and never touches other keys', () => {
    const rows = attachTimestampColumns(
      [
        {
          ...entry('notes/a.md', { due: cell('2026-01-01', 'string') }),
          mtime: new Date(2026, 7, 31, 9, 30).getTime(),
        },
      ],
      type,
    )
    expect(rows[0]?.properties['touched']).toEqual({
      value: '2026-08-31',
      valueType: 'string',
      valueNumber: null,
    })
    expect(rows[0]?.properties['due']).toEqual(cell('2026-01-01', 'string'))
  })

  it('overrides a hand-written value and leaves an unstamped row absent', () => {
    const rows = attachTimestampColumns(
      [
        {
          ...entry('notes/a.md', { touched: cell('yesterday, by hand', 'string') }),
          mtime: 0,
        },
      ],
      type,
    )
    // A zero mtime deletes even a stored value: the view never passes a
    // hand-written cell off as computed (the reverse columns' contract).
    expect(rows[0]?.properties['touched']).toBeUndefined()
  })
})

describe('effectiveCollectionSorts', () => {
  const type: TagType = {
    properties: [
      { name: 'Touched', key: 'touched', type: 'updated' },
      { name: 'Due', key: 'due', type: 'date' },
    ],
  }

  it('reroutes an updated-column sort onto the mtime sentinel', () => {
    expect(effectiveCollectionSorts(type, [{ key: 'touched', direction: 'desc' }])).toEqual([
      { key: UPDATED_SORT_KEY, direction: 'desc' },
    ])
  })

  it('leaves every other sort (and no sort) alone', () => {
    expect(effectiveCollectionSorts(type, [{ key: 'due', direction: 'asc' }])).toEqual([
      { key: 'due', direction: 'asc' },
    ])
    expect(effectiveCollectionSorts(type, [])).toEqual([])
    expect(effectiveCollectionSorts(null, [{ key: 'touched', direction: 'asc' }])).toEqual([
      { key: 'touched', direction: 'asc' },
    ])
  })
})

describe('attachFormulaColumns', () => {
  const type: TagType = {
    properties: [
      { name: 'Price', key: 'price', type: 'number' },
      {
        name: 'With VAT',
        key: 'with-vat',
        type: 'formula',
        formula: { expression: 'round(prop("price") * 1.22, 2)' },
      },
    ],
  }

  it('computes numeric cells the footer can sum, and errors stay in the cell', () => {
    const rows = attachFormulaColumns(
      [
        entry('notes/a.md', { price: cell('100', 'number', 100) }),
        entry('notes/b.md', { price: cell('not a number', 'string') }),
      ],
      type,
    )
    expect(rows[0]?.properties['with-vat']).toEqual({
      value: '122',
      valueType: 'number',
      valueNumber: 122,
    })
    expect(rows[1]?.properties['with-vat']).toEqual({
      value: '#ERROR (* expects a number)',
      valueType: 'string',
      valueNumber: null,
    })
  })

  it('reads one snapshot: formulas never see each other, and empty results stay absent', () => {
    const chained: TagType = {
      properties: [
        { name: 'A', key: 'a', type: 'formula', formula: { expression: '"x"' } },
        { name: 'B', key: 'b', type: 'formula', formula: { expression: 'prop("a")' } },
        { name: 'C', key: 'c', type: 'formula', formula: { expression: 'prop("nothing")' } },
      ],
    }
    const rows = attachFormulaColumns([entry('notes/a.md', {})], chained)
    expect(rows[0]?.properties['a']).toEqual({ value: 'x', valueType: 'string', valueNumber: null })
    // `b` read the pre-formula snapshot, where `a` holds nothing.
    expect(rows[0]?.properties['b']).toBeUndefined()
    expect(rows[0]?.properties['c']).toBeUndefined()
  })
})
