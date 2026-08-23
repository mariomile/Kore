import { beforeEach, describe, expect, it, vi } from 'vitest'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const writeNote = vi.hoisted(() =>
  vi.fn<(path: string, contents: string, generation: number) => Promise<void>>(async () => {}),
)
const createNoteIfAbsent = vi.hoisted(() =>
  vi.fn<() => Promise<{ kind: 'created' | 'exists'; modifiedMs?: number }>>(),
)
const openSession = vi.hoisted(() => vi.fn(() => null))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  readNote,
  writeNote,
  createNoteIfAbsent,
}))
vi.mock('@/editor/open-documents', () => ({ openSession }))

const { readTagDefinition, saveTagType } = await import('./tag-type-write')

beforeEach(() => {
  readNote.mockReset()
  writeNote.mockClear()
  createNoteIfAbsent.mockReset()
  openSession.mockReset().mockReturnValue(null)
})

describe('readTagDefinition', () => {
  it('reports a missing definition as absent with an empty schema', async () => {
    readNote.mockRejectedValue(new Error('not found'))
    expect(await readTagDefinition('Book')).toEqual({
      path: 'tags/book.md',
      exists: false,
      needsConversion: false,
      properties: [],
    })
  })

  it('flags an unmarked note at the path as needing conversion', async () => {
    readNote.mockResolvedValue('# Just a note\n')
    expect(await readTagDefinition('book')).toMatchObject({
      exists: true,
      needsConversion: true,
      properties: [],
    })
  })

  it('reads the stored schema from a marked definition', async () => {
    readNote.mockResolvedValue(
      '---\nlore: tag\nproperties:\n  - {name: Author, key: author, type: text}\n---\n',
    )
    expect(await readTagDefinition('book')).toMatchObject({
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
    })
  })
})

describe('saveTagType', () => {
  const schema = [{ name: 'Author', key: 'author', type: 'text' as const }]

  it('creates the definition note when the path is free', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'created', modifiedMs: 1 })

    await saveTagType('Book', schema, 3)

    const [path, contents, generation] = createNoteIfAbsent.mock.calls[0] as unknown as [
      string,
      string,
      number,
    ]
    expect(path).toBe('tags/book.md')
    expect(generation).toBe(3)
    expect(contents).toContain('lore: tag')
    expect(contents).toContain('key: author')
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('patches an existing definition, preserving body and unknown keys', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'exists' })
    readNote.mockResolvedValue('---\nlore: tag\nproperties: []\ncolor: red\n---\nBody stays.\n')

    await saveTagType('book', schema, 3)

    const written = String(writeNote.mock.calls[0]?.[1])
    expect(written).toContain('color: red')
    expect(written).toContain('Body stays.')
    expect(written).toContain('key: author')
  })

  it('surfaces a broken-YAML definition instead of rewriting it', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'exists' })
    readNote.mockResolvedValue('---\n{ broken\n---\nBody.\n')

    await expect(saveTagType('book', schema, 3)).rejects.toThrow(/invalid YAML/)
    expect(writeNote).not.toHaveBeenCalled()
  })
})
