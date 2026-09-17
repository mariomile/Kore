import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { decodeTagTypeJson } from '../tags/tag-type'
import { listNotes } from './note-list'

vi.mock('../tags/tag-type', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tags/tag-type')>()
  return { ...original, decodeTagTypeJson: vi.fn(original.decodeTagTypeJson) }
})

const invoke = vi.fn<(command: string, args: Record<string, unknown>) => Promise<unknown>>()

beforeEach(() => {
  invoke.mockReset()
  vi.mocked(decodeTagTypeJson).mockClear()
  setBridge({ invoke, listen: async () => () => {} })
})

afterEach(() => setBridge(null))

function row(path: string, schemas: (string | null)[]) {
  return {
    path,
    title: path,
    mtime: 1,
    preview: '',
    tagSchemas: JSON.stringify(schemas),
    is_pinned: 0,
    pinned_order: null,
    tags: null,
  }
}

it('validates shared valid and malformed schemas once without changing Inbox membership', async () => {
  // The legacy empty property list is a valid zero-property supertag.
  const valid = '[]'
  const invalid = '{broken'
  invoke.mockResolvedValue([
    ...Array.from({ length: 100 }, (_, i) => row(`notes/${i}.md`, [invalid, valid])),
    row('notes/broken.md', [invalid]),
    row('notes/untagged.md', [null]),
    row('daily/2026-09-17.md', [null]),
  ])
  const result = await listNotes()
  expect(result.slice(0, 100).every((entry) => !entry.isInbox)).toBe(true)
  expect(result.slice(100).map((entry) => entry.isInbox)).toEqual([true, true, false])
  expect(decodeTagTypeJson).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('does not retain validity across queries or a changed definition', async () => {
  invoke.mockResolvedValueOnce([row('notes/book.md', ['[]'])])
  expect((await listNotes())[0]?.isInbox).toBe(false)
  invoke.mockResolvedValueOnce([row('notes/book.md', ['[]'])])
  await listNotes()
  expect(decodeTagTypeJson).toHaveBeenCalledTimes(2)
  invoke.mockResolvedValueOnce([row('notes/book.md', ['{broken'])])
  expect((await listNotes())[0]?.isInbox).toBe(true)
  expect(decodeTagTypeJson).toHaveBeenCalledTimes(3)
})
