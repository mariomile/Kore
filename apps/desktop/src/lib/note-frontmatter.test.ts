import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteSession } from '@/editor/note-session'

const readNote = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>())
const writeNote = vi.hoisted(() => vi.fn(async () => {}))
const openSession = vi.hoisted(() => vi.fn<(path: string) => NoteSession | null>(() => null))

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  readNote,
  writeNote,
}))
vi.mock('@/editor/open-documents', () => ({ openSession }))

const { commitNoteFrontmatter, readNoteSource } = await import('./note-frontmatter')

function fakeSession(options: { live?: string | null; canCommit?: boolean }) {
  const commitFrontmatter = vi.fn(async () => options.canCommit ?? true)
  const session = {
    liveContent: () => options.live ?? null,
    commitFrontmatter,
  } as unknown as NoteSession
  return { session, commitFrontmatter }
}

beforeEach(() => {
  readNote.mockReset()
  writeNote.mockClear()
  openSession.mockReset().mockReturnValue(null)
})

describe('readNoteSource', () => {
  it("reads the open session's loaded buffer, not disk", async () => {
    openSession.mockReturnValue(fakeSession({ live: '# live\n' }).session)
    await expect(readNoteSource('notes/a.md')).resolves.toBe('# live\n')
    expect(readNote).not.toHaveBeenCalled()
  })

  it('falls back to disk while the session is still loading (liveContent null)', async () => {
    openSession.mockReturnValue(fakeSession({ live: null }).session)
    readNote.mockResolvedValue('# disk\n')
    await expect(readNoteSource('notes/a.md')).resolves.toBe('# disk\n')
  })

  it('reads disk when no session is open', async () => {
    readNote.mockResolvedValue('# disk\n')
    await expect(readNoteSource('notes/a.md')).resolves.toBe('# disk\n')
  })
})

describe('commitNoteFrontmatter', () => {
  it('lands the patch through the live session when it can take it', async () => {
    const { session, commitFrontmatter } = fakeSession({ live: '# A\n', canCommit: true })
    openSession.mockReturnValue(session)

    await commitNoteFrontmatter('notes/a.md', { pinned: true }, 3)

    expect(commitFrontmatter).toHaveBeenCalledWith({ pinned: true })
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('falls back to a disk patch when the session declines the patch', async () => {
    openSession.mockReturnValue(fakeSession({ live: '# A\n', canCommit: false }).session)
    readNote.mockResolvedValue('# A\n')

    await commitNoteFrontmatter('notes/a.md', { pinned: true }, 3)

    expect(writeNote).toHaveBeenCalledWith('notes/a.md', '---\npinned: true\n---\n# A\n', 3)
  })

  it('patches disk directly when no session is open', async () => {
    readNote.mockResolvedValue('# A\n')

    await commitNoteFrontmatter('notes/a.md', { private: true }, 3)

    expect(writeNote).toHaveBeenCalledWith('notes/a.md', '---\nprivate: true\n---\n# A\n', 3)
  })

  it('writes nothing when the patch changes nothing', async () => {
    readNote.mockResolvedValue('---\npinned: true\n---\n# A\n')

    await commitNoteFrontmatter('notes/a.md', { pinned: true }, 3)

    expect(writeNote).not.toHaveBeenCalled()
  })

  it('writes property values and deletes a key set to undefined (TDR 0005)', async () => {
    readNote.mockResolvedValue('---\nstatus: to-read\n---\n# A\n')

    await commitNoteFrontmatter(
      'notes/a.md',
      { properties: { author: 'Le Guin', rating: 4.5, status: undefined } },
      3,
    )

    expect(writeNote).toHaveBeenCalledWith(
      'notes/a.md',
      '---\nauthor: Le Guin\nrating: 4.5\n---\n# A\n',
      3,
    )
  })

  it('drops reserved keys from a properties patch — they can never clobber metadata', async () => {
    readNote.mockResolvedValue('---\nprivate: true\n---\n# A\n')

    await commitNoteFrontmatter(
      'notes/a.md',
      { properties: { private: undefined, pinned: 9, lore: 'x', author: 'Ada' } },
      3,
    )

    expect(writeNote).toHaveBeenCalledWith(
      'notes/a.md',
      '---\nprivate: true\nauthor: Ada\n---\n# A\n',
      3,
    )
  })

  it('writes a tagSchema patch as the marker plus the whole properties list', async () => {
    readNote.mockResolvedValue('# Books\n')

    await commitNoteFrontmatter(
      'tags/book.md',
      { tagSchema: [{ name: 'Author', key: 'author', type: 'text' }] },
      3,
    )

    expect(writeNote).toHaveBeenCalledWith(
      'tags/book.md',
      '---\nlore: tag\nproperties:\n  - name: Author\n    key: author\n    type: text\n---\n# Books\n',
      3,
    )
  })

  it('writes or clears a bound template on a tag definition', async () => {
    readNote.mockResolvedValue('---\nlore: tag\nproperties: []\n---\n')

    await commitNoteFrontmatter('tags/book.md', { tagTemplate: 'templates/book.md' }, 3)
    const written = writeNote.mock.calls[0] as unknown as [string, string, number]
    expect(written[1]).toContain('template: templates/book.md')

    writeNote.mockClear()
    readNote.mockResolvedValue('---\nlore: tag\ntemplate: templates/book.md\nproperties: []\n---\n')
    await commitNoteFrontmatter('tags/book.md', { tagTemplate: null }, 3)
    const cleared = writeNote.mock.calls[0] as unknown as [string, string, number]
    expect(cleared[1]).not.toContain('template:')
  })

  it('leaves unrelated keys and comments untouched around a property write', async () => {
    readNote.mockResolvedValue('---\n# reading log\nstatus: to-read\nid: 01H\n---\n# A\n')

    await commitNoteFrontmatter('notes/a.md', { properties: { status: 'done' } }, 3)

    expect(writeNote).toHaveBeenCalledWith(
      'notes/a.md',
      '---\n# reading log\nstatus: done\nid: 01H\n---\n# A\n',
      3,
    )
  })
})
