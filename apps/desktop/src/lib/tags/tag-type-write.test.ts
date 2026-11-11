import { beforeEach, describe, expect, it, vi } from 'vitest'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const writeNote = vi.hoisted(() =>
  vi.fn<(path: string, contents: string, generation: number) => Promise<void>>(async () => {}),
)
const createNoteIfAbsent = vi.hoisted(() =>
  vi.fn<() => Promise<{ kind: 'created' | 'exists'; modifiedMs?: number }>>(),
)
const openSession = vi.hoisted(() => vi.fn(() => null))
const tagExtendsLoop = vi.hoisted(() =>
  vi.fn<(tag: string, parents: readonly string[]) => Promise<string | null>>(async () => null),
)

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  readNote,
  writeNote,
  createNoteIfAbsent,
  tagExtendsLoop,
}))
vi.mock('@/editor/open-documents', () => ({ openSession }))

const { readTagDefinition, saveTagType } = await import('./tag-type-write')

beforeEach(() => {
  readNote.mockReset()
  writeNote.mockClear()
  createNoteIfAbsent.mockReset()
  openSession.mockReset().mockReturnValue(null)
  tagExtendsLoop.mockClear()
})

describe('readTagDefinition', () => {
  it('reports a missing definition as absent with an empty schema', async () => {
    readNote.mockRejectedValue(new Error('not found'))
    expect(await readTagDefinition('Book')).toEqual({
      path: 'tags/book.md',
      exists: false,
      needsConversion: false,
      properties: [],
      template: null,
      icon: null,
      parents: [],
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
      '---\nkore: tag\nproperties:\n  - {name: Author, key: author, type: text}\n---\n',
    )
    expect(await readTagDefinition('book')).toMatchObject({
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
    })
  })

  it('reads the icon from a marked definition', async () => {
    readNote.mockResolvedValue('---\nkore: tag\nicon: "📚"\nproperties: []\n---\n')
    expect(await readTagDefinition('book')).toMatchObject({ icon: '📚', properties: [] })
  })

  it('reads a bound template from a marked definition', async () => {
    readNote.mockResolvedValue('---\nkore: tag\ntemplate: templates/book.md\nproperties: []\n---\n')
    expect(await readTagDefinition('book')).toMatchObject({
      template: 'templates/book.md',
      properties: [],
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
    expect(contents).toContain('kore: tag')
    expect(contents).toContain('key: author')
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('seeds a fresh definition with every schema field — target, reverse, formula', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'created', modifiedMs: 1 })

    await saveTagType(
      'Book',
      [
        { name: 'Company', key: 'company', type: 'relation', target: 'company' },
        {
          name: 'People',
          key: 'people',
          type: 'reverse',
          reverse: { tag: 'person', property: 'company' },
        },
        {
          name: 'With VAT',
          key: 'with-vat',
          type: 'formula',
          formula: { expression: 'round(prop("price") * 1.22, 2)' },
        },
      ],
      3,
    )

    // The seed once forked from the update serializer and silently dropped
    // exactly these keys on freshly created collections.
    const [, contents] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(contents).toContain('target: company')
    expect(contents).toContain('tag: person')
    expect(contents).toContain('expression:')
  })

  it('routes an existing definition through an open editor session', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'exists' })
    const commitFrontmatter = vi.fn(async () => true)
    openSession.mockReturnValue({
      liveContent: () => '---\nkore: tag\nproperties: []\n---\nDirty body edits\n',
      commitFrontmatter,
    } as never)

    await saveTagType('book', schema, 3)

    // The schema lands in the live header (the session flushes it), so the
    // buffer's own next save can never revert it — and no disk write races
    // the open buffer.
    // Template and icon weren't given, so they are left as they are.
    expect(commitFrontmatter).toHaveBeenCalledWith({ tagSchema: schema })
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('patches an existing definition, preserving body and unknown keys', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'exists' })
    readNote.mockResolvedValue('---\nkore: tag\nproperties: []\ncolor: red\n---\nBody stays.\n')

    await saveTagType('book', schema, 3)

    const written = (writeNote.mock.calls[0] as unknown as [string, string, number])[1]
    expect(written).toContain('color: red')
    expect(written).toContain('Body stays.')
    expect(written).toContain('key: author')
  })

  it('rewrites the pre-rename lore: tag marker as kore: tag on save', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'exists' })
    readNote.mockResolvedValue('---\nlore: tag\nproperties: []\n---\nBody stays.\n')

    await saveTagType('book', schema, 3)

    const written = (writeNote.mock.calls[0] as unknown as [string, string, number])[1]
    expect(written).toContain('kore: tag')
    expect(written).not.toContain('lore:')
    expect(written).toContain('Body stays.')
  })

  it('surfaces a broken-YAML definition instead of rewriting it', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'exists' })
    readNote.mockResolvedValue('---\n{ broken\n---\nBody.\n')

    await expect(saveTagType('book', schema, 3)).rejects.toThrow(/invalid YAML/)
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('writes a bound template onto a new definition', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'created', modifiedMs: 1 })

    await saveTagType('Book', schema, 3, { template: 'templates/book.md' })

    const [, contents] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(contents).toContain('template: templates/book.md')
  })

  it('writes the icon onto a new definition', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'created', modifiedMs: 1 })

    await saveTagType('Book', schema, 3, { icon: '📚' })

    const [, contents] = createNoteIfAbsent.mock.calls[0] as unknown as [string, string, number]
    expect(contents).toMatch(/icon: "?📚"?/)
  })
})

describe('saveTagType parents (Plan 33 B2)', () => {
  it('reads extends: from the definition', async () => {
    readNote.mockResolvedValue('---\nkore: tag\nextends: [contact]\nproperties: []\n---\n')
    expect(await readTagDefinition('client')).toMatchObject({ parents: ['contact'] })
  })

  it('writes extends: on a new definition when parents are given', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'created' })
    await saveTagType('client', [], 7, { parents: ['contact'] })
    const seed = (createNoteIfAbsent.mock.calls[0] as unknown as [string, string])[1]
    expect(seed).toContain('extends:')
    expect(seed).toContain('contact')
  })

  it('refuses parents that would close a loop, writing nothing', async () => {
    tagExtendsLoop.mockResolvedValueOnce('client')
    await expect(saveTagType('contact', [], 7, { parents: ['client'] })).rejects.toThrow(
      "#contact can't build on #client",
    )
    expect(createNoteIfAbsent).not.toHaveBeenCalled()
  })

  it('leaves extends: alone when parents are not given', async () => {
    createNoteIfAbsent.mockResolvedValue({ kind: 'created' })
    await saveTagType('client', [], 7)
    expect(tagExtendsLoop).not.toHaveBeenCalled()
    const seed = (createNoteIfAbsent.mock.calls[0] as unknown as [string, string])[1]
    expect(seed).not.toContain('extends')
  })
})
