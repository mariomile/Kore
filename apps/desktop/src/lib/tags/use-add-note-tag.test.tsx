import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { TagType } from '@kore/core'

const tagType = vi.hoisted(() => ({ value: null as TagType | null }))
const commitNoteBodyTransform = vi.hoisted(() =>
  vi.fn(async (_path: string, _transform: (source: string) => string, _generation: number) => {}),
)
const maybeMoveTaggedInboxNote = vi.hoisted(() =>
  vi.fn(
    async (
      _path: string,
      _homeFolder: string | undefined,
      _generation: number,
    ): Promise<string | null> => null,
  ),
)
const toastAdd = vi.hoisted(() => vi.fn())

vi.mock('@kore/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@kore/core')>()
  return {
    ...core,
    getTagType: async () => tagType.value,
    // The index read `next-number` needs; this note's tag already holds 41.
    startingValuesFor: async (_tag: string, type: TagType | null) =>
      core.startingValues(type, { nextNumbers: new Map([['number', 42]]) }),
  }
})
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
vi.mock('@/lib/note-frontmatter', () => ({ commitNoteBodyTransform }))
vi.mock('@/lib/tags/auto-move-tagged-note', () => ({ maybeMoveTaggedInboxNote }))
vi.mock('@/lib/tags/use-commit-note-property', () => ({ invalidateOnNextIndexApply: () => {} }))
vi.mock('@/components/ui/toast', () => ({ toast: { add: toastAdd } }))

const { useAddNoteTag } = await import('./use-add-note-tag')

/** Run the hook's write and return what the transform did to `source`. */
async function setType(source: string, tag = 'book'): Promise<string> {
  const { result } = await renderHook(() => useAddNoteTag())
  await result.current('notes/dispossessed.md', tag)
  const [path, transform, generation] = commitNoteBodyTransform.mock.calls[0]!
  expect(path).toBe('notes/dispossessed.md')
  expect(generation).toBe(7)
  return transform(source)
}

beforeEach(() => {
  tagType.value = null
  commitNoteBodyTransform.mockClear()
  maybeMoveTaggedInboxNote.mockClear()
  toastAdd.mockClear()
})

describe('useAddNoteTag', () => {
  it('adds an untyped tag to frontmatter tags, stamping nothing and leaving the body alone', async () => {
    expect(await setType('# The Dispossessed\n', 'idea')).toBe(
      '---\ntags:\n  - idea\n---\n# The Dispossessed\n',
    )
  })

  it('writes the tag and the type’s created stamps in one transform', async () => {
    tagType.value = { properties: [{ name: 'Added', key: 'added', type: 'created' }] }
    const next = await setType('# The Dispossessed\n')
    expect(next).toMatch(
      /^---\ntags:\n {2}- book\nadded: \d{4}-\d{2}-\d{2}\n---\n# The Dispossessed\n$/,
    )
  })

  it('writes the fields’ starting values, keeping a value the note already has', async () => {
    tagType.value = {
      properties: [
        { name: 'Status', key: 'status', type: 'select', options: ['to-read'], default: 'to-read' },
        { name: 'Number', key: 'number', type: 'number', default: 'next-number' },
        { name: 'Rating', key: 'rating', type: 'rating', default: 3 },
      ],
    }
    const next = await setType('---\nrating: 5\n---\n# The Dispossessed\n')
    expect(next).toBe(
      '---\nrating: 5\ntags:\n  - book\nstatus: to-read\nnumber: 42\n---\n# The Dispossessed\n',
    )
  })

  it('leaves a note that already carries the tag byte-identical', async () => {
    tagType.value = { properties: [{ name: 'Added', key: 'added', type: 'created' }] }
    const source = '# The Dispossessed\n\n#book\n'
    expect(await setType(source)).toBe(source)
  })

  it('auto-moves an inbox note into the tag’s default folder only when the tag was newly added', async () => {
    tagType.value = { folder: 'CRM/People', properties: [] }
    commitNoteBodyTransform.mockImplementationOnce(async (_path, transform) => {
      transform('# Ada Lovelace\n')
    })
    const { result } = await renderHook(() => useAddNoteTag())
    await result.current('notes/ada.md', 'person')
    expect(maybeMoveTaggedInboxNote).toHaveBeenCalledWith('notes/ada.md', 'CRM/People', 7)

    maybeMoveTaggedInboxNote.mockClear()
    commitNoteBodyTransform.mockImplementationOnce(async (_path, transform) => {
      transform('---\ntags:\n  - person\n---\n# Ada Lovelace\n')
    })
    await result.current('notes/ada.md', 'person')
    expect(maybeMoveTaggedInboxNote).not.toHaveBeenCalled()
  })

  it('surfaces a failed write instead of throwing', async () => {
    commitNoteBodyTransform.mockRejectedValueOnce(new Error('note is open'))
    const { result } = await renderHook(() => useAddNoteTag())
    await result.current('notes/dispossessed.md', 'book')
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', description: 'note is open' }),
    )
  })
})
