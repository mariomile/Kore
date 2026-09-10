import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionDefinition, CollectionReferenceResolution } from '@reflect/core'

const createNoteWithTitle = vi.hoisted(() => vi.fn(async () => 'notes/new.md'))
const createNoteIfAbsent = vi.hoisted(() => vi.fn(async () => ({ kind: 'created' as const })))
const readNote = vi.hoisted(() =>
  vi.fn(
    async () =>
      '---\nid: collection-id\nkoreCollection: true\nkore:\n  collection:\n    version: 1\n    sources:\n      tags: []\n      include: []\n      exclude: []\n---\n# Reading\n',
  ),
)
const getNoteIdsByPath = vi.hoisted(() => vi.fn(async () => new Map<string, string | null>()))
const getTagType = vi.hoisted(() => vi.fn(async () => null))
const resolveCollectionNoteReference = vi.hoisted(() =>
  vi.fn<(reference: string) => Promise<CollectionReferenceResolution>>(async (reference) => ({
    status: 'resolved',
    path: reference,
  })),
)
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  createNoteWithTitle,
  createNoteIfAbsent,
  readNote,
  getNoteIdsByPath,
  getTagType,
  resolveCollectionNoteReference,
}))
const commitNoteBodyTransform = vi.hoisted(() =>
  vi.fn<(path: string, transform: (source: string) => string, generation: number) => Promise<void>>(
    async () => {},
  ),
)
const commitNoteFrontmatter = vi.hoisted(() => vi.fn(async () => {}))
const readNoteSource = vi.hoisted(() =>
  vi.fn(async (path: string) =>
    path === 'notes/reading.md' ? await readNote() : '# Existing note\n',
  ),
)
vi.mock('@/lib/note-frontmatter', () => ({
  commitNoteBodyTransform,
  commitNoteFrontmatter,
  readNoteSource,
}))

const { addReusableCollectionMember, createReusableCollectionRow, removeReusableCollectionMember } =
  await import('./reusable-collection-write')

const DEFINITION: CollectionDefinition = {
  id: 'collection-id',
  path: 'notes/reading.md',
  title: 'Reading',
  config: {
    version: 1,
    sources: { tags: [], include: [], exclude: [] },
    create: { properties: { status: 'next' } },
  },
}

beforeEach(() => {
  createNoteWithTitle.mockClear()
  createNoteIfAbsent.mockClear()
  readNote.mockClear()
  getNoteIdsByPath.mockClear()
  getTagType.mockClear()
  resolveCollectionNoteReference.mockClear()
  commitNoteBodyTransform.mockClear()
  commitNoteFrontmatter.mockClear()
  readNoteSource.mockClear()
  readNoteSource.mockImplementation(async (path: string) =>
    path === 'notes/reading.md' ? await readNote() : '# Existing note\n',
  )
})

describe('reusable collection writes', () => {
  it('creates an original row with explicit defaults and manually includes it', async () => {
    readNoteSource.mockImplementation(async (path: string) =>
      path === 'notes/new.md' ? '---\nid: fresh-note-id\n---\n# Dune\n' : await readNote(),
    )
    resolveCollectionNoteReference.mockImplementation(async (reference: string) =>
      reference === 'fresh-note-id'
        ? { status: 'unresolved', reference }
        : { status: 'resolved', path: reference },
    )
    await expect(
      createReusableCollectionRow({
        definition: DEFINITION,
        generation: 4,
        title: 'Dune',
        properties: { status: 'done' },
      }),
    ).resolves.toBe('notes/new.md')

    expect(createNoteWithTitle).toHaveBeenCalledWith('Dune', 4)
    expect(commitNoteFrontmatter).toHaveBeenCalledWith(
      'notes/new.md',
      { properties: { status: 'done' } },
      4,
    )
    expect(commitNoteBodyTransform).toHaveBeenCalledWith(
      'notes/reading.md',
      expect.any(Function),
      4,
    )
  })

  it('adds and removes membership by changing the definition, never the note', async () => {
    await addReusableCollectionMember(DEFINITION, 'notes/dune.md', 4)
    let transform = commitNoteBodyTransform.mock.calls[0]![1] as (source: string) => string
    let updated = transform(await readNote())
    expect(updated).toContain('include:\n        - notes/dune.md')

    commitNoteBodyTransform.mockClear()
    await removeReusableCollectionMember(DEFINITION, 'notes/dune.md', 4)
    transform = commitNoteBodyTransform.mock.calls[0]![1] as (source: string) => string
    updated = transform(await readNote())
    expect(updated).toContain('exclude:\n        - notes/dune.md')
    expect(commitNoteFrontmatter).not.toHaveBeenCalled()
  })

  it('stores stable note ids and reads the latest definition for each update', async () => {
    const latestSource = (await readNote()).replace(
      'include: []',
      'include:\n        - already-there',
    )
    readNoteSource.mockImplementation(async (path: string) =>
      path === 'notes/reading.md' ? latestSource : '# Existing note\n',
    )
    getNoteIdsByPath.mockResolvedValueOnce(new Map([['notes/dune.md', 'note-id']]))
    resolveCollectionNoteReference.mockResolvedValueOnce({
      status: 'resolved',
      path: 'notes/dune.md',
    })
    await addReusableCollectionMember(DEFINITION, 'notes/dune.md', 4)

    const transform = commitNoteBodyTransform.mock.calls[0]![1] as (source: string) => string
    const updated = transform(latestSource)
    expect(updated).toContain('- already-there')
    expect(updated).toContain('- note-id')
  })

  it('falls back from ambiguous ids and clears exclusions that resolve to the added note', async () => {
    const latestSource = (await readNote()).replace('exclude: []', 'exclude:\n        - "[[Dune]]"')
    readNoteSource.mockImplementation(async (path: string) =>
      path === 'notes/reading.md' ? latestSource : '# Existing note\n',
    )
    getNoteIdsByPath.mockResolvedValueOnce(new Map([['notes/dune.md', 'duplicate-id']]))
    resolveCollectionNoteReference.mockImplementation(async (reference: string) =>
      reference === 'duplicate-id'
        ? {
            status: 'ambiguous' as const,
            reference,
            candidates: ['notes/dune.md', 'notes/copy.md'],
          }
        : { status: 'resolved' as const, path: 'notes/dune.md' },
    )
    const definition: CollectionDefinition = {
      ...DEFINITION,
      config: {
        ...DEFINITION.config,
        sources: { tags: [], include: [], exclude: ['[[Dune]]'] },
      },
    }

    await addReusableCollectionMember(definition, 'notes/dune.md', 4)
    const transform = commitNoteBodyTransform.mock.calls[0]![1] as (source: string) => string
    const updated = transform(latestSource)
    expect(updated).toContain('- notes/dune.md')
    expect(updated).not.toContain('[[Dune]]')
  })

  it('manually includes a created row when its tag matches but its required relation does not', async () => {
    resolveCollectionNoteReference.mockImplementation(async (reference: string) => ({
      status: 'resolved',
      path: reference === 'page-id' ? 'notes/page.md' : 'notes/wrong-page.md',
    }))
    await createReusableCollectionRow({
      definition: {
        ...DEFINITION,
        config: {
          version: 1,
          sources: {
            tags: ['task'],
            relation: { key: 'project', target: 'page-id' },
            include: [],
            exclude: [],
          },
          create: { tag: 'task', properties: { project: '[[Wrong page]]' } },
        },
      },
      generation: 4,
      title: 'Follow up',
    })

    expect(commitNoteBodyTransform).toHaveBeenCalledWith(
      'notes/reading.md',
      expect.any(Function),
      4,
    )
  })
})
