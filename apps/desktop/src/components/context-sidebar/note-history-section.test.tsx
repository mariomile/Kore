import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteHistorySection } from './note-history-section'

const gitNoteHistory = vi.hoisted(() => vi.fn())
const gitNoteVersion = vi.hoisted(() => vi.fn())
const gitCommitAll = vi.hoisted(() => vi.fn())
const writeNote = vi.hoisted(() => vi.fn(async () => {}))
const indexNote = vi.hoisted(() => vi.fn(async () => {}))
const emitFileChanges = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  gitNoteHistory,
  gitNoteVersion,
  gitCommitAll,
  writeNote,
  indexNote,
  emitFileChanges,
}))
const invalidateIndexQueries = vi.hoisted(() => vi.fn())
vi.mock('@/lib/query-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/query-client')>()),
  invalidateIndexQueries,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 }, indexGeneration: 3 }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: { dateFormat: 'mdy', timeFormat: '12h' },
    updateSettings: () => {},
  }),
}))

const VERSIONS = [
  { commit: 'c2', timeMs: new Date('2026-08-19T10:00:00').getTime(), summary: 'Update Plan' },
  { commit: 'c1', timeMs: new Date('2026-08-01T09:00:00').getTime(), summary: 'Create Plan' },
]

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NoteHistorySection path="notes/plan.md" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  gitNoteHistory.mockReset().mockResolvedValue(VERSIONS)
  gitNoteVersion.mockReset().mockImplementation(async (commit: string) => {
    return commit === 'c2' ? '# Plan\n\nline two\n' : '# Plan\n\nold line\n'
  })
  gitCommitAll
    .mockReset()
    .mockResolvedValue({ committed: true, sha: 'snap', ahead: 1, skippedLargeFiles: [] })
  writeNote.mockClear()
  indexNote.mockClear()
  emitFileChanges.mockClear()
  invalidateIndexQueries.mockClear()
})

describe('NoteHistorySection', () => {
  it('lists the note’s versions and shows the empty state without history', async () => {
    const view = await renderSection()
    await expect.element(view.getByText('Update Plan')).toBeVisible()
    await expect.element(view.getByText('Create Plan')).toBeVisible()
    await view.unmount()

    gitNoteHistory.mockResolvedValue([])
    const empty = await renderSection()
    await expect.element(empty.getByText(/No versions yet/)).toBeVisible()
    await empty.unmount()
  })

  it('opens the dialog on a version with its full preview', async () => {
    const view = await renderSection()
    await view.getByText('Create Plan').click()
    await expect.element(view.getByRole('dialog')).toBeVisible()
    await expect.element(view.getByText('old line')).toBeVisible()
    expect(gitNoteVersion).toHaveBeenCalledWith('c1', 'notes/plan.md', 7)
    await view.unmount()
  })

  it('shows the per-save diff in the Changes view', async () => {
    const view = await renderSection()
    await view.getByText('Update Plan').click()
    await view.getByRole('button', { name: 'Changes' }).click()
    // c2 vs its predecessor c1: "old line" out, "line two" in.
    await expect.element(view.getByText('old line')).toBeVisible()
    await expect.element(view.getByText('line two')).toBeVisible()
    expect(gitNoteVersion).toHaveBeenCalledWith('c1', 'notes/plan.md', 7)
    await view.unmount()
  })

  it('restores a version: snapshot first, then the write-back, then closes', async () => {
    const view = await renderSection()
    await view.getByText('Create Plan').click()
    await view.getByRole('button', { name: 'Restore this version' }).click()

    await expect.poll(() => writeNote.mock.calls.length).toBe(1)
    expect(gitCommitAll).toHaveBeenCalledWith('Snapshot before restoring notes/plan.md', 7)
    expect(gitCommitAll.mock.invocationCallOrder[0]).toBeLessThan(
      writeNote.mock.invocationCallOrder[0] ?? 0,
    )
    expect(writeNote).toHaveBeenCalledWith('notes/plan.md', '# Plan\n\nold line\n', 7)
    expect(indexNote).toHaveBeenCalledWith('notes/plan.md', {
      generation: 3,
      content: '# Plan\n\nold line\n',
    })
    expect(emitFileChanges).toHaveBeenCalledWith([{ path: 'notes/plan.md', kind: 'upsert' }])
    expect(invalidateIndexQueries).toHaveBeenCalled()
    await expect.poll(() => view.container.querySelector('[role="dialog"]')).toBeNull()
    await view.unmount()
  })
})
