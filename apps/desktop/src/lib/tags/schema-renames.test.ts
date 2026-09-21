import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionValue } from '@reflect/core'

const listNotesWithProperty = vi.hoisted(() =>
  vi.fn<(key: string) => Promise<{ notePath: string; value: CollectionValue }[]>>(),
)
const commitNoteFrontmatter = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listNotesWithProperty,
}))
vi.mock('@/lib/note-frontmatter', () => ({ commitNoteFrontmatter }))

const { planPropertyRenames, migratePropertyRenames } = await import('./schema-renames')

/** One indexed property row, as `listNotesWithProperty` returns it. */
function row(notePath: string, value: string): { notePath: string; value: CollectionValue } {
  return { notePath, value: { value, valueType: 'string', valueNumber: null } }
}

beforeEach(() => {
  listNotesWithProperty.mockReset()
  commitNoteFrontmatter.mockClear()
})

describe('planPropertyRenames', () => {
  it('keeps only the renames whose old key notes still carry', async () => {
    listNotesWithProperty.mockImplementation(async (key) =>
      key === 'author' ? [row('notes/dune.md', 'Herbert')] : [],
    )
    expect(
      await planPropertyRenames([
        { from: 'author', to: 'written-by' },
        { from: 'pages', to: 'length' },
      ]),
    ).toEqual([{ from: 'author', to: 'written-by', notes: [row('notes/dune.md', 'Herbert')] }])
  })

  it('plans nothing for an empty list, without touching the index', async () => {
    expect(await planPropertyRenames([])).toEqual([])
    expect(listNotesWithProperty).not.toHaveBeenCalled()
  })
})

describe('migratePropertyRenames', () => {
  it('clears the old key and writes the new one, one note at a time', async () => {
    await migratePropertyRenames(
      [
        {
          from: 'author',
          to: 'written-by',
          notes: [row('notes/dune.md', 'Herbert'), row('notes/ubik.md', 'Dick')],
        },
      ],
      7,
    )
    expect(commitNoteFrontmatter.mock.calls).toEqual([
      ['notes/dune.md', { properties: { author: undefined, 'written-by': 'Herbert' } }, 7],
      ['notes/ubik.md', { properties: { author: undefined, 'written-by': 'Dick' } }, 7],
    ])
  })
})
