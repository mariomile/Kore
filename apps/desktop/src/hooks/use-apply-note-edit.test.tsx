import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

/** A stand-in disk: read, yield to the event loop, then write — the real race window. */
const disk = vi.hoisted(() => ({ content: '', missing: false }))

vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 1 } }),
}))
vi.mock('@/editor/open-documents', () => ({ openSession: () => null }))
vi.mock('@/lib/tags/use-commit-note-property', () => ({ invalidateOnNextIndexApply: () => {} }))
vi.mock('@/lib/note-frontmatter', () => ({
  commitNoteBodyTransform: async (_path: string, transform: (source: string) => string) => {
    const snapshot = disk.content
    await new Promise((resolve) => setTimeout(resolve, 5))
    disk.content = transform(snapshot)
  },
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  readNote: async () => {
    if (disk.missing) {
      throw { kind: 'notFound', message: 'gone' }
    }
    return disk.content
  },
}))

const { useApplyNoteEdit, STALE_NOTE_EDIT_MESSAGE } = await import('./use-apply-note-edit')

beforeEach(() => {
  disk.content = '# Day\n\n- one\n- two\n'
  disk.missing = false
})

describe('useApplyNoteEdit', () => {
  it('lands two accepts on the same note one after the other, keeping both hunks', async () => {
    const { result } = await renderHook(() => useApplyNoteEdit())
    await Promise.all([
      result.current('daily/d.md', { oldText: '- one', newText: '- [x] one' }),
      result.current('daily/d.md', { oldText: '- two', newText: '- [x] two' }),
    ])
    expect(disk.content).toBe('# Day\n\n- [x] one\n- [x] two\n')
  })

  it('refuses a stale passage and an append to a note that no longer exists', async () => {
    const { result } = await renderHook(() => useApplyNoteEdit())
    await expect(
      result.current('daily/d.md', { oldText: '- three', newText: '- 3' }),
    ).rejects.toThrow(STALE_NOTE_EDIT_MESSAGE)
    disk.missing = true
    await expect(
      result.current('daily/d.md', { oldText: '', newText: '- four\n' }),
    ).rejects.toThrow(STALE_NOTE_EDIT_MESSAGE)
    expect(disk.content).toBe('# Day\n\n- one\n- two\n')
  })
})
