import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoteIfAbsent, listDir, readNote, writeNote } from '../graph/commands'
import { isReflectManagedNote } from '../graph/note-management'
import { parseNote } from '../markdown/extract'
import { collectResourceFile, collectResourceLink, resourceUrl } from './resource-collection'

vi.mock('../graph/commands', () => ({
  createNoteIfAbsent: vi.fn(),
  listDir: vi.fn(),
  readNote: vi.fn(),
  writeNote: vi.fn(),
}))
const notes = new Map<string, string>()
const origin = { generation: 3, sourcePath: 'notes/origin.md', private: false }

beforeEach(() => {
  notes.clear()
  vi.clearAllMocks()
  vi.mocked(readNote).mockImplementation(async (path) => {
    const source = notes.get(path)
    if (source === undefined) throw { kind: 'notFound', message: 'missing' }
    return source
  })
  vi.mocked(createNoteIfAbsent).mockImplementation(async (path, source) => {
    if (notes.has(path)) return { kind: 'collision' }
    notes.set(path, source)
    return { kind: 'created', modifiedMs: 1 }
  })
  vi.mocked(writeNote).mockImplementation(async (path, source) => {
    notes.set(path, source)
  })
  vi.mocked(listDir).mockResolvedValue([{ path: 'assets/report.pdf', size: 4, modifiedMs: 1 }])
})

describe('automatic resource collections', () => {
  it('collects links and files once, preserves annotations and accumulates origins', async () => {
    const path = await collectResourceLink('https://example.com', 'Example', origin)
    notes.set(path, `${notes.get(path)}\nMy annotation\n`)
    const repeated = await collectResourceLink('https://example.com/', 'New title', {
      ...origin,
      sourcePath: 'daily/2026-09-05.md',
    })
    expect(repeated).toBe(path)
    expect(isReflectManagedNote(path, notes.get(path)!)).toBe(false)
    expect(notes.get(path)).toContain('My annotation')
    expect(notes.get(path)).toContain('[[daily/2026-09-05]]')
    expect(notes.get('tags/link.md')).toContain('key: url')
    const upload = vi.fn(async () => 'assets/report.pdf')
    const file = new File(['data'], 'report.pdf', { type: 'application/pdf' })
    expect(await collectResourceFile(file, origin, upload)).toBe('assets/report.pdf')
    expect(
      await collectResourceFile(file, { ...origin, sourcePath: 'notes/other.md' }, upload),
    ).toBe('assets/report.pdf')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(notes.get('tags/pdf.md')).toContain('key: files')
    const card = [...notes].find(([, source]) => source.includes('#pdf\n'))
    expect(card?.[1]).toContain('[[notes/other]]')
    await collectResourceFile(
      new File(['image bytes'], 'photo.png', { type: 'image/png' }),
      origin,
      async () => 'assets/photo.png',
    )
    await collectResourceFile(
      new File(['file bytes'], 'document.txt'),
      origin,
      async () => 'assets/document.txt',
    )
    expect(
      [...notes.values()].some((source) => source.includes('![photo.png](assets/photo.png)')),
    ).toBe(true)
    expect(notes.has('tags/image.md')).toBe(true)
    expect(notes.has('tags/file.md')).toBe(true)
  })

  it('isolates private origins and refuses unsafe URLs or failed writes', async () => {
    const publicPath = await collectResourceLink('https://example.com/', 'Public', origin)
    const privatePath = await collectResourceLink('https://example.com/', 'Private title', {
      ...origin,
      private: true,
    })
    expect(privatePath).not.toBe(publicPath)
    expect(
      parseNote({ path: privatePath, source: notes.get(privatePath)! }).frontmatter.private,
    ).toBe(true)
    expect(notes.get(publicPath)).not.toContain('Private title')
    expect(resourceUrl('text https://example.com')).toBeNull()
    expect(resourceUrl('https://user:secret@example.com')).toBeNull()
    vi.mocked(createNoteIfAbsent).mockRejectedValueOnce(new Error('disk full'))
    await expect(collectResourceLink('https://other.com/', 'Other', origin)).rejects.toThrow(
      'disk full',
    )
  })
})
