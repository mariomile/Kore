import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { PRIVATE_NOTE_EDIT_ERROR, type TagType } from '@reflect/core'

const source = vi.hoisted(() => ({ text: '# The Dispossessed\n' }))
const tagType = vi.hoisted(() => ({ value: null as TagType | null }))
const commitNoteBodyTransform = vi.hoisted(() =>
  vi.fn(async (_path: string, _transform: (source: string) => string, _generation: number) => {}),
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getTagType: async () => tagType.value,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
vi.mock('@/lib/note-frontmatter', () => ({
  commitNoteBodyTransform,
  readNoteSource: async () => source.text,
}))
vi.mock('@/lib/tags/use-commit-note-property', () => ({ invalidateOnNextIndexApply: () => {} }))

const { useApplyNoteType, STALE_NOTE_TYPE_MESSAGE } = await import('./use-apply-note-type')

const PATH = 'notes/dispossessed.md'

/** Accept one proposal and return what its transform did to the note. */
async function accept(change: { tag: string; remove?: boolean }): Promise<string> {
  const { result } = await renderHook(() => useApplyNoteType())
  await result.current({ path: PATH, tag: change.tag, remove: change.remove ?? false })
  const [path, transform, generation] = commitNoteBodyTransform.mock.calls[0]!
  expect(path).toBe(PATH)
  expect(generation).toBe(7)
  return transform(source.text)
}

beforeEach(() => {
  source.text = '# The Dispossessed\n'
  tagType.value = null
  commitNoteBodyTransform.mockClear()
})

describe('useApplyNoteType', () => {
  it('writes the tag and the type’s created stamps in one transform', async () => {
    tagType.value = { properties: [{ name: 'Added', key: 'added', type: 'created' }] }
    const next = await accept({ tag: 'book' })
    expect(next).toContain('#book\n')
    expect(next).toMatch(/^---\nadded: \d{4}-\d{2}-\d{2}\n---\n/)
  })

  it('strips the tag on a removal, stamping nothing', async () => {
    source.text = '# The Dispossessed\n\n#book\n'
    tagType.value = { properties: [{ name: 'Added', key: 'added', type: 'created' }] }
    expect(await accept({ tag: 'book', remove: true })).toBe('# The Dispossessed\n')
  })

  it('refuses a note whose membership moved on since the proposal', async () => {
    source.text = '# The Dispossessed\n\n#book\n'
    const { result } = await renderHook(() => useApplyNoteType())
    await expect(result.current({ path: PATH, tag: 'book', remove: false })).rejects.toThrow(
      STALE_NOTE_TYPE_MESSAGE,
    )
    source.text = '# The Dispossessed\n'
    await expect(result.current({ path: PATH, tag: 'book', remove: true })).rejects.toThrow(
      STALE_NOTE_TYPE_MESSAGE,
    )
    expect(commitNoteBodyTransform).not.toHaveBeenCalled()
  })

  it('refuses a note that turned private after the proposal', async () => {
    source.text = '---\nprivate: true\n---\n# The Dispossessed\n'
    const { result } = await renderHook(() => useApplyNoteType())
    await expect(result.current({ path: PATH, tag: 'book', remove: false })).rejects.toThrow(
      PRIVATE_NOTE_EDIT_ERROR,
    )
    expect(commitNoteBodyTransform).not.toHaveBeenCalled()
  })
})
