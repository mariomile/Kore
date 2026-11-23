import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionValue } from '@kore/core'

const listNotesWithProperty = vi.hoisted(() =>
  vi.fn<
    (
      key: string,
      options?: { tag?: string },
    ) => Promise<{ notePath: string; value: CollectionValue }[]>
  >(),
)
const commitNoteFrontmatter = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  listNotesWithProperty,
}))
vi.mock('@/lib/note-frontmatter', () => ({ commitNoteFrontmatter }))

const { planPropertyRenames, migratePropertyRenames, migrateOptionRenames } =
  await import('./schema-renames')

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

describe('migrateOptionRenames', () => {
  it('rewrites renamed values on the type’s own notes and skips the rest', async () => {
    listNotesWithProperty.mockImplementation(async () => [
      row('p/a.md', 'Todo'),
      row('p/b.md', 'Done'),
      {
        notePath: 'p/c.md',
        value: { value: '["Todo","Done"]', valueType: 'list', valueNumber: null },
      },
    ])
    const changed = await migrateOptionRenames(
      'project',
      [{ key: 'status', renames: [{ from: 'Todo', to: 'To do' }] }],
      7,
    )
    expect(listNotesWithProperty).toHaveBeenCalledWith('status', { tag: 'project' })
    expect(changed).toBe(2)
    expect(commitNoteFrontmatter.mock.calls).toEqual([
      ['p/a.md', { properties: { status: 'To do' } }, 7],
      ['p/c.md', { properties: { status: ['To do', 'Done'] } }, 7],
    ])
  })

  it('merges a deleted option into another and takes a removed one off the notes', async () => {
    listNotesWithProperty.mockImplementation(async () => [
      row('p/a.md', 'in pausa'),
      row('p/b.md', 'Old'),
      {
        notePath: 'p/c.md',
        value: { value: '["Old","paused"]', valueType: 'list', valueNumber: null },
      },
    ])
    await migrateOptionRenames(
      'project',
      [
        {
          key: 'status',
          renames: [
            { from: 'in pausa', to: 'paused' },
            { from: 'Old', to: null },
          ],
        },
      ],
      7,
    )
    expect(commitNoteFrontmatter.mock.calls).toEqual([
      ['p/a.md', { properties: { status: 'paused' } }, 7],
      ['p/b.md', { properties: { status: undefined } }, 7],
      ['p/c.md', { properties: { status: ['paused'] } }, 7],
    ])
  })
})
