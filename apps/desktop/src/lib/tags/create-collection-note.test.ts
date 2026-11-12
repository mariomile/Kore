import { beforeEach, describe, expect, it, vi } from 'vitest'

const createNoteIfAbsent = vi.hoisted(() => vi.fn(async () => ({ kind: 'created' as const })))
const createTypedNoteWithTitle = vi.hoisted(() => vi.fn(async () => 'notes/dune.md'))
const readNote = vi.hoisted(() => vi.fn<(path: string, generation?: number) => Promise<string>>())

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  createNoteIfAbsent,
  createTypedNoteWithTitle,
  readNote,
}))

const {
  bodyForCollectionCreate,
  createCollectionNote,
  createTitledCollectionNote,
  createTypedCollectionNote,
} = await import('./create-collection-note')

const VALUES = {
  title: '',
  date: 'Mon, August 24th, 2026',
  dateIso: '2026-08-24',
  time: '2:15 PM',
}

beforeEach(() => {
  createNoteIfAbsent.mockClear()
  createTypedNoteWithTitle.mockClear()
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
    // The type lives in the Type field, never as a hidden body tag line.
    expect(seed).toMatch(/\ntags:\n {2}- book\n/)
    expect(seed).not.toContain('#book')
  })

  it('skips a property patch when none are set', async () => {
    await createCollectionNote('book', 1)

    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toMatch(/\ntags:\n {2}- book\n/)
    expect(seed).not.toContain('#book')
    expect(seed).not.toContain('status:')
  })

  it('uses the supplied body instead of the untitled seed', async () => {
    await createCollectionNote('book', 1, { finished: '2026-08-10' }, '# Template\n')

    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toContain('# Template')
    expect(seed).toMatch(/\ntags:\n {2}- book\n/)
    expect(seed).toContain('finished: 2026-08-10')
  })
})

describe('createCollectionNote type placement', () => {
  it('keeps the untitled seed loadable and puts the type only in the frontmatter', async () => {
    await createCollectionNote('book', 1)

    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toMatch(/^---\nid: [0-9a-z]{26}\ntags:\n {2}- book\n---\n#\n$/)
  })

  it('still types a row whose template mentions the tag in prose', async () => {
    // A mention is not membership (#401): the row must get the type anyway.
    await createCollectionNote('book', 1, {}, '# Dune\n\nA #book I loved.\n')

    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toMatch(/\ntags:\n {2}- book\n/)
  })
})

describe('createTitledCollectionNote', () => {
  it('births the titled row with type and starting values in one create', async () => {
    const type = {
      properties: [
        {
          name: 'Status',
          key: 'status',
          type: 'select' as const,
          options: ['to-read'],
          default: 'to-read',
        },
      ],
    }
    const path = await createTitledCollectionNote('book', 3, 'Dune', type, VALUES)

    expect(path).toBe('notes/dune.md')
    // One create carries the type (as the Type field) and the starting
    // values; no second frontmatter write races an editor opening the row.
    expect(createTypedNoteWithTitle).toHaveBeenCalledTimes(1)
    expect(createTypedNoteWithTitle).toHaveBeenCalledWith(
      'Dune',
      'book',
      { status: 'to-read' },
      3,
      '',
    )
    expect(createNoteIfAbsent).not.toHaveBeenCalled()
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

  it('writes the fields’ starting values under the caller’s own', async () => {
    const type = {
      properties: [
        {
          name: 'Status',
          key: 'status',
          type: 'select' as const,
          options: ['to-read', 'done'],
          default: 'to-read',
        },
        { name: 'Met', key: 'met', type: 'date' as const, default: 'today' },
      ],
    }
    await createTypedCollectionNote('book', 1, {}, type, VALUES)
    const [, seed] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(seed).toContain('status: to-read')
    expect(seed).toMatch(/met: \d{4}-\d{2}-\d{2}/)

    createNoteIfAbsent.mockClear()
    await createTypedCollectionNote('book', 1, { status: 'done' }, type, VALUES)
    const [, lane] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(lane).toContain('status: done')
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
