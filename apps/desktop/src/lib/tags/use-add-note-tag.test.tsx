import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { TagType } from '@reflect/core'

const tagType = vi.hoisted(() => ({ value: null as TagType | null }))
const commitNoteBodyTransform = vi.hoisted(() =>
  vi.fn(async (_path: string, _transform: (source: string) => string, _generation: number) => {}),
)
const toastAdd = vi.hoisted(() => vi.fn())

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getTagType: async () => tagType.value,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))
vi.mock('@/lib/note-frontmatter', () => ({ commitNoteBodyTransform }))
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
  toastAdd.mockClear()
})

describe('useAddNoteTag', () => {
  it('appends the membership line to an untyped tag, stamping nothing', async () => {
    expect(await setType('# The Dispossessed\n', 'idea')).toBe('# The Dispossessed\n\n#idea\n')
  })

  it('writes the tag and the type’s created stamps in one transform', async () => {
    tagType.value = { properties: [{ name: 'Added', key: 'added', type: 'created' }] }
    const next = await setType('# The Dispossessed\n')
    expect(next).toContain('#book\n')
    expect(next).toMatch(/^---\nadded: \d{4}-\d{2}-\d{2}\n---\n/)
  })

  it('leaves a note that already carries the tag byte-identical', async () => {
    tagType.value = { properties: [{ name: 'Added', key: 'added', type: 'created' }] }
    const source = '# The Dispossessed\n\n#book\n'
    expect(await setType(source)).toBe(source)
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
