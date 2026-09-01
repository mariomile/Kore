import { beforeEach, describe, expect, it, vi } from 'vitest'

const createNoteIfAbsent = vi.hoisted(() => vi.fn(async () => ({ kind: 'created' as const })))
const readNote = vi.hoisted(() => vi.fn<(path: string, generation?: number) => Promise<string>>())

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  createNoteIfAbsent,
  readNote,
}))

const { bodyForCollectionCreate, createCollectionNote, createTypedCollectionNote } =
  await import('./create-collection-note')

const VALUES = {
  title: '',
  date: 'Mon, August 24th, 2026',
  dateIso: '2026-08-24',
  time: '2:15 PM',
}

beforeEach(() => {
  createNoteIfAbsent.mockClear()
  readNote.mockReset()
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

    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toContain('#book')
    expect(seed).not.toContain('status:')
  })

  it('uses the supplied body instead of the untitled seed', async () => {
    await createCollectionNote('book', 1, { finished: '2026-08-10' }, '# Template\n')

    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toContain('# Template')
    expect(seed).toContain('#book')
    expect(seed).toContain('finished: 2026-08-10')
  })
})

describe('createTypedCollectionNote', () => {
  it('stamps created properties with today, and a caller value wins over the stamp', async () => {
    const type = {
      properties: [
        { name: 'Started', key: 'started', type: 'created' as const },
        { name: 'Status', key: 'status', type: 'select' as const, options: ['done'] },
      ],
    }
    await createTypedCollectionNote('book', 1, { status: 'done' }, type, VALUES)
    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toMatch(/started: \d{4}-\d{2}-\d{2}/)
    expect(seed).toContain('status: done')

    createNoteIfAbsent.mockClear()
    await createTypedCollectionNote('book', 1, { started: '2020-05-05' }, type, VALUES)
    const [, second] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(second).toContain('started: 2020-05-05')
  })
})

describe('bodyForCollectionCreate', () => {
  it('returns the untitled seed when the type names no template', async () => {
    const body = await bodyForCollectionCreate({ properties: [] }, VALUES, 1)
    expect(body).toContain('id:')
    expect(readNote).not.toHaveBeenCalled()
  })

  it('expands a bound template and keeps a fresh id', async () => {
    readNote.mockResolvedValue('---\ntitle: Book\n---\n# {{title}}\n\nStarted {{date:iso}}\n')
    const body = await bodyForCollectionCreate(
      { properties: [], template: 'templates/book.md' },
      { ...VALUES, title: 'Dune' },
      7,
    )
    expect(readNote).toHaveBeenCalledWith('templates/book.md', 7)
    expect(body).toContain('# Dune')
    expect(body).toContain('Started 2026-08-24')
    expect(body).toContain('id:')
    expect(body).not.toContain('title: Book')
  })

  it('falls back to the untitled seed when the template cannot be read', async () => {
    readNote.mockRejectedValue(new Error('missing'))
    const body = await bodyForCollectionCreate(
      { properties: [], template: 'templates/book.md' },
      VALUES,
      1,
    )
    expect(body).toContain('id:')
    expect(body).not.toContain('Started')
  })
})
