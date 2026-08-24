import { beforeEach, describe, expect, it, vi } from 'vitest'

const createNoteIfAbsent = vi.hoisted(() =>
  vi.fn(async () => ({ kind: 'created' as const })),
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  createNoteIfAbsent,
}))

const { createCollectionNote } = await import('./create-collection-note')

beforeEach(() => {
  createNoteIfAbsent.mockClear()
})

describe('createCollectionNote', () => {
  it('writes an untitled note tagged and with the given properties', async () => {
    const path = await createCollectionNote('book', 4, { status: 'done' })

    expect(path).toMatch(/^notes\/.+\.md$/)
    expect(createNoteIfAbsent).toHaveBeenCalledTimes(1)
    const [writtenPath, seed, generation] = createNoteIfAbsent.mock.calls[0] as unknown as [
      string,
      string,
      number,
    ]
    expect(writtenPath).toBe(path)
    expect(generation).toBe(4)
    expect(seed).toContain('status: done')
    expect(seed).toContain('#book')
  })

  it('skips a property patch when none are set', async () => {
    await createCollectionNote('book', 1)

    const seed = createNoteIfAbsent.mock.calls[0]![1] as string
    expect(seed).toContain('#book')
    expect(seed).not.toContain('status:')
  })

  it('uses the supplied body instead of the untitled seed', async () => {
    await createCollectionNote('book', 1, { finished: '2026-08-10' }, '# Template\n')

    const seed = createNoteIfAbsent.mock.calls[0]![1] as string
    expect(seed).toContain('# Template')
    expect(seed).toContain('#book')
    expect(seed).toContain('finished: 2026-08-10')
  })
})
