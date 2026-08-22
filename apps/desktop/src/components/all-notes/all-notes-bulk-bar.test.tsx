import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteListEntry } from '@reflect/core'
import { AllNotesBulkBar } from './all-notes-bulk-bar'

const writeNote = vi.hoisted(() => vi.fn(async () => {}))
const readNoteSource = vi.hoisted(() => vi.fn(async () => 'Some prose.\n'))
const moveNoteCarryingSession = vi.hoisted(() => vi.fn(async () => {}))
const openSession = vi.hoisted(() => vi.fn(() => null as { isDirty: () => boolean } | null))
const operationFail = vi.hoisted(() => vi.fn())
const startOperation = vi.hoisted(() =>
  vi.fn(() => ({ progress: vi.fn(), done: vi.fn(), fail: operationFail })),
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  writeNote,
}))
vi.mock('@/lib/note-frontmatter', () => ({ readNoteSource }))
vi.mock('@/editor/move-note', () => ({ moveNoteCarryingSession }))
vi.mock('@/editor/open-documents', () => ({ openSession }))
vi.mock('@/lib/operations', () => ({ startOperation }))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))

const NOTES: NoteListEntry[] = [
  { path: 'notes/a.md', title: 'A', snippet: '', tags: [], mtime: 1, isPinned: false },
  { path: 'inbox/b.md', title: 'B', snippet: '', tags: [], mtime: 2, isPinned: false },
] as unknown as NoteListEntry[]

const onDone = vi.fn()
const onRequestTrash = vi.fn()

async function renderBar(paths: readonly string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <AllNotesBulkBar
        paths={paths}
        trashablePaths={paths}
        notes={NOTES}
        onRequestTrash={onRequestTrash}
        onDone={onDone}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  writeNote.mockReset().mockResolvedValue(undefined)
  readNoteSource.mockReset().mockResolvedValue('Some prose.\n')
  moveNoteCarryingSession.mockReset().mockResolvedValue(undefined)
  openSession.mockReset().mockReturnValue(null)
  startOperation.mockClear()
  operationFail.mockClear()
  onDone.mockClear()
  onRequestTrash.mockClear()
})

describe('AllNotesBulkBar', () => {
  it('renders nothing without a selection', async () => {
    await renderBar([])
    expect(page.getByRole('button', { name: /^Tag/ }).elements()).toHaveLength(0)
  })

  it('tags every selected note and clears the selection', async () => {
    await renderBar(['notes/a.md', 'inbox/b.md'])
    await userEvent.click(page.getByRole('button', { name: 'Tag (2)' }))
    await userEvent.fill(page.getByLabelText('Tag name'), 'reading')
    await userEvent.click(page.getByRole('button', { name: 'Tag', exact: true }))

    await vi.waitFor(() => expect(writeNote).toHaveBeenCalledTimes(2))
    expect(writeNote).toHaveBeenCalledWith('notes/a.md', 'Some prose.\n\n#reading\n', 7)
    expect(writeNote).toHaveBeenCalledWith('inbox/b.md', 'Some prose.\n\n#reading\n', 7)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('leaves a note that already carries the tag byte-identical', async () => {
    readNoteSource.mockResolvedValue('Some prose. #reading\n')
    await renderBar(['notes/a.md'])
    await userEvent.click(page.getByRole('button', { name: 'Tag (1)' }))
    await userEvent.fill(page.getByLabelText('Tag name'), 'reading')
    await userEvent.click(page.getByRole('button', { name: 'Tag', exact: true }))

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('never writes over a note with unsaved changes', async () => {
    // Tagging edits prose on disk; an open dirty session would see that as an
    // external edit and park a conflict the user never asked for.
    openSession.mockReturnValue({ isDirty: () => true })
    await renderBar(['notes/a.md'])
    await userEvent.click(page.getByRole('button', { name: 'Tag (1)' }))
    await userEvent.fill(page.getByLabelText('Tag name'), 'reading')
    await userEvent.click(page.getByRole('button', { name: 'Tag', exact: true }))

    await vi.waitFor(() => expect(operationFail).toHaveBeenCalled())
    expect(writeNote).not.toHaveBeenCalled()
    expect(operationFail.mock.calls[0]?.[0]).toContain('unsaved changes')
    // A partial failure keeps the selection so the user can retry it.
    expect(onDone).not.toHaveBeenCalled()
  })

  it('moves notes through the session-carrying helper, keeping the filename', async () => {
    await renderBar(['notes/a.md', 'inbox/b.md'])
    await userEvent.click(page.getByRole('button', { name: 'Move (2)' }))
    await userEvent.fill(page.getByLabelText('Destination folder'), 'archive')
    await userEvent.click(page.getByRole('button', { name: 'Move', exact: true }))

    await vi.waitFor(() => expect(moveNoteCarryingSession).toHaveBeenCalledTimes(2))
    expect(moveNoteCarryingSession).toHaveBeenCalledWith('notes/a.md', 'archive/a.md', 7)
    expect(moveNoteCarryingSession).toHaveBeenCalledWith('inbox/b.md', 'archive/b.md', 7)
  })

  it('skips a note already in the destination folder', async () => {
    await renderBar(['inbox/b.md'])
    await userEvent.click(page.getByRole('button', { name: 'Move (1)' }))
    await userEvent.fill(page.getByLabelText('Destination folder'), 'inbox')
    await userEvent.click(page.getByRole('button', { name: 'Move', exact: true }))

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(moveNoteCarryingSession).not.toHaveBeenCalled()
  })

  it('offers the folders notes already live in as completions', async () => {
    await renderBar(['notes/a.md'])
    await userEvent.click(page.getByRole('button', { name: 'Move (1)' }))
    const options = document.querySelectorAll('#all-notes-folders option')
    expect([...options].map((option) => option.getAttribute('value'))).toEqual(['inbox', 'notes'])
  })

  it('hands the trash button back to the screen, which owns the confirm', async () => {
    await renderBar(['notes/a.md'])
    await userEvent.click(page.getByRole('button', { name: 'Trash (1)' }))
    expect(onRequestTrash).toHaveBeenCalled()
  })
})
