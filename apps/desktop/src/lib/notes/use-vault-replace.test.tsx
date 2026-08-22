import { renderHook } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useVaultReplace, type ReplaceScope } from './use-vault-replace'

const listNotes = vi.hoisted(() => vi.fn())
const readNote = vi.hoisted(() => vi.fn())
const writeNote = vi.hoisted(() => vi.fn(async (_path: string, _content: string) => {}))
const openSession = vi.hoisted(() =>
  vi.fn(() => null as { isDirty: () => boolean; liveContent: () => string | null } | null),
)
const operationFail = vi.hoisted(() => vi.fn())
const startOperation = vi.hoisted(() =>
  vi.fn(() => ({ progress: vi.fn(), done: vi.fn(), fail: operationFail })),
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  listNotes,
  readNote,
  writeNote,
}))
vi.mock('@/editor/open-documents', () => ({ openSession }))
vi.mock('@/lib/operations', () => ({ startOperation }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const SCOPE: ReplaceScope = {
  needle: 'cat',
  replacement: 'dog',
  matchCase: true,
  wholeWord: false,
}

/** A vault of `path -> source`, served through listNotes/readNote. */
function vault(files: Record<string, string>): void {
  listNotes.mockResolvedValue(
    Object.keys(files).map((path) => ({ path, title: path.replace(/\.md$/, '') })),
  )
  readNote.mockImplementation(async (path: string) => {
    const source = files[path]
    if (source === undefined) {
      throw new Error('missing')
    }
    return source
  })
}

beforeEach(() => {
  listNotes.mockReset()
  readNote.mockReset()
  writeNote.mockReset().mockResolvedValue(undefined)
  openSession.mockReset().mockReturnValue(null)
  startOperation.mockClear()
  operationFail.mockClear()
})

describe('useVaultReplace — scan', () => {
  it('never writes', async () => {
    vault({ 'a.md': 'the cat\n', 'b.md': 'no match\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)

    expect(writeNote).not.toHaveBeenCalled()
    expect(scanned.changeable).toBe(1)
    expect(scanned.liveMatches).toBe(1)
  })

  it('counts protected matches instead of hiding them', async () => {
    // A preview that shows fewer matches than the user can see in the note is
    // a preview that lies.
    vault({ 'a.md': '# The cat note\n\n`cat`\n\nthe cat\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)

    expect(scanned.liveMatches).toBe(1)
    expect(scanned.skippedMatches).toBe(2) // the title and the code span
  })

  it('reads the live editor buffer, not disk, when a pane holds the note', async () => {
    vault({ 'a.md': 'stale disk content\n' })
    openSession.mockReturnValue({ isDirty: () => false, liveContent: () => 'the cat, live\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)

    expect(scanned.liveMatches).toBe(1)
    expect(scanned.notes[0]?.source).toBe('the cat, live\n')
  })

  it('blocks a note with unsaved changes rather than dropping it', async () => {
    vault({ 'a.md': 'the cat\n' })
    openSession.mockReturnValue({ isDirty: () => true, liveContent: () => 'the cat\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)

    expect(scanned.notes).toHaveLength(1)
    expect(scanned.notes[0]?.blocked).toBe('has unsaved changes')
    expect(scanned.changeable).toBe(0)
  })

  it('finds nothing for an empty needle', async () => {
    vault({ 'a.md': 'anything\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    expect((await result.current.scan({ ...SCOPE, needle: '' })).notes).toEqual([])
  })
})

describe('useVaultReplace — apply', () => {
  it('writes the previewed replacement to every changeable note', async () => {
    vault({ 'a.md': 'the cat\n', 'b.md': 'a cat here\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)
    const changed = await result.current.apply(SCOPE, scanned)

    expect(changed).toBe(2)
    expect(writeNote).toHaveBeenCalledWith('a.md', 'the dog\n', 7)
    expect(writeNote).toHaveBeenCalledWith('b.md', 'a dog here\n', 7)
  })

  it('refuses a note whose bytes moved between preview and apply', async () => {
    // The gate that keeps a stale preview from becoming data loss.
    const files: Record<string, string> = { 'a.md': 'the cat\n', 'b.md': 'a cat here\n' }
    vault(files)
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)

    files['a.md'] = 'the cat, edited elsewhere\n'
    const changed = await result.current.apply(SCOPE, scanned)

    expect(changed).toBe(1)
    expect(writeNote).toHaveBeenCalledTimes(1)
    expect(writeNote).toHaveBeenCalledWith('b.md', 'a dog here\n', 7)
    expect(operationFail).toHaveBeenCalled()
    expect(operationFail.mock.calls[0]?.[0]).toContain('changed since the preview')
  })

  it('does not let one failure strand the rest', async () => {
    vault({ 'a.md': 'the cat\n', 'b.md': 'a cat here\n' })
    writeNote.mockImplementation(async (path: string) => {
      if (path === 'a.md') {
        throw new Error('disk full')
      }
    })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    const scanned = await result.current.scan(SCOPE)

    expect(await result.current.apply(SCOPE, scanned)).toBe(1)
    expect(operationFail.mock.calls[0]?.[0]).toContain('disk full')
  })

  it('leaves protected matches alone in the bytes it writes', async () => {
    vault({ 'a.md': '# The cat note\n\n`cat`\n\nthe cat\n' })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    await result.current.apply(SCOPE, await result.current.scan(SCOPE))

    expect(writeNote).toHaveBeenCalledWith('a.md', '# The cat note\n\n`cat`\n\nthe dog\n', 7)
  })
})

describe('useVaultReplace — undo', () => {
  it('puts back exactly what the replace wrote', async () => {
    const files: Record<string, string> = { 'a.md': 'the cat\n' }
    vault(files)
    writeNote.mockImplementation(async (path: string, content: string) => {
      files[path] = content
    })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    await result.current.apply(SCOPE, await result.current.scan(SCOPE))
    expect(files['a.md']).toBe('the dog\n')

    expect(await result.current.undo()).toBe(1)
    expect(files['a.md']).toBe('the cat\n')
  })

  it('keeps a note edited after the replace rather than clobbering it twice', async () => {
    const files: Record<string, string> = { 'a.md': 'the cat\n' }
    vault(files)
    writeNote.mockImplementation(async (path: string, content: string) => {
      files[path] = content
    })
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    await result.current.apply(SCOPE, await result.current.scan(SCOPE))

    files['a.md'] = 'the dog, then edited\n'
    expect(await result.current.undo()).toBe(0)
    expect(files['a.md']).toBe('the dog, then edited\n')
    expect(operationFail.mock.calls.at(-1)?.[0]).toContain('edited since the replace')
  })

  it('offers nothing to undo before a replace has run', async () => {
    const { result } = await renderHook(() => useVaultReplace(), { wrapper })
    expect(result.current.canUndo).toBe(false)
    expect(await result.current.undo()).toBe(0)
  })
})
