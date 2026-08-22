import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '@/routing/router'
import { NoteListContextMenu } from './note-context-menu'

const getPinnedNotes = vi.hoisted(() => vi.fn())
const getNote = vi.hoisted(() => vi.fn())
const toggleNotePinned = vi.hoisted(() => vi.fn(async () => true))
const toggleNotePrivate = vi.hoisted(() => vi.fn(async () => true))
const runCopyDeepLink = vi.hoisted(() => vi.fn(async () => {}))
const runCopyNotePath = vi.hoisted(() => vi.fn(async () => {}))
const runNoteExport = vi.hoisted(() => vi.fn(async () => {}))
const openRouteInNewWindow = vi.hoisted(() => vi.fn(async () => true))
const operationFail = vi.hoisted(() => vi.fn())
const startOperation = vi.hoisted(() =>
  vi.fn(() => ({ progress: vi.fn(), done: vi.fn(), fail: operationFail })),
)
const graph = vi.hoisted(
  () =>
    ({ current: { root: '/g', name: 'g', generation: 7 } }) as {
      current: { root: string; name: string; generation: number } | null
    },
)

vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  hasBridge: () => true,
  getPinnedNotes,
  getNote,
}))
vi.mock('@/lib/note-pin', () => ({ toggleNotePinned }))
vi.mock('@/lib/note-private', () => ({ toggleNotePrivate }))
vi.mock('@/lib/note-deep-link', () => ({ runCopyDeepLink }))
vi.mock('@/lib/note-copy-path', () => ({ runCopyNotePath }))
vi.mock('@/lib/note-export', () => ({ runNoteExport }))
vi.mock('@/lib/operations', () => ({ startOperation }))
vi.mock('@/lib/windows/open-in-new-window', () => ({ openRouteInNewWindow }))
vi.mock('@/providers/graph-provider', () => ({ useGraph: () => ({ graph: graph.current }) }))

async function renderMenu(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return await render(
    <QueryClientProvider client={client}>
      <RouterProvider initialRoute={{ kind: 'allNotes', tag: null }}>
        <NoteListContextMenu>
          {/* Two rows under ONE menu — the delegated shape the list uses. */}
          <div data-note-path={path}>A note row</div>
          <div data-note-path="notes/other.md">Another row</div>
          <div>Not a note</div>
        </NoteListContextMenu>
      </RouterProvider>
    </QueryClientProvider>,
  )
}

/** Right-click a row the way a user does; the menu opens on contextmenu. */
async function openMenu(text = 'A note row'): Promise<void> {
  await userEvent.click(page.getByText(text), { button: 'right' })
  await expect.element(page.getByRole('menu')).toBeInTheDocument()
}

beforeEach(() => {
  graph.current = { root: '/g', name: 'g', generation: 7 }
  getPinnedNotes.mockReset().mockResolvedValue([])
  getNote.mockReset().mockResolvedValue(undefined)
  toggleNotePinned.mockReset().mockResolvedValue(true)
  toggleNotePrivate.mockReset().mockResolvedValue(true)
  runCopyDeepLink.mockReset().mockResolvedValue(undefined)
  runCopyNotePath.mockReset().mockResolvedValue(undefined)
  runNoteExport.mockReset().mockResolvedValue(undefined)
  openRouteInNewWindow.mockReset().mockResolvedValue(true)
  startOperation.mockClear()
  operationFail.mockClear()
})

describe('NoteListContextMenu', () => {
  it('does not open over parts of the list that are not a note', async () => {
    // The capture handler swallows the event before the trigger sees it, so
    // the menu can never open on a stale path.
    await renderMenu('notes/atomic-habits.md')
    await userEvent.click(page.getByText('Not a note'), { button: 'right' })
    expect(page.getByRole('menu').elements()).toHaveLength(0)
  })

  it('acts on the row that was actually clicked', async () => {
    await renderMenu('notes/atomic-habits.md')
    await openMenu('Another row')
    await userEvent.click(page.getByRole('menuitem', { name: /^Pin/ }))
    expect(toggleNotePinned).toHaveBeenCalledWith('notes/other.md', 7)
  })

  it('opens on right-click and runs the note actions against the graph generation', async () => {
    await renderMenu('notes/atomic-habits.md')
    await openMenu()

    await userEvent.click(page.getByRole('menuitem', { name: /^Pin/ }))
    expect(toggleNotePinned).toHaveBeenCalledWith('notes/atomic-habits.md', 7)

    await openMenu()
    await userEvent.click(page.getByRole('menuitem', { name: /^Copy deep link/ }))
    expect(runCopyDeepLink).toHaveBeenCalledWith('notes/atomic-habits.md', 7)

    await openMenu()
    await userEvent.click(page.getByRole('menuitem', { name: /^Copy note path/ }))
    expect(runCopyNotePath).toHaveBeenCalledWith('/g', 'notes/atomic-habits.md')

    await openMenu()
    await userEvent.click(page.getByRole('menuitem', { name: /^Export as HTML/ }))
    expect(runNoteExport).toHaveBeenCalledWith('notes/atomic-habits.md', 7)
  })

  it('opens the note in a new window', async () => {
    await renderMenu('notes/atomic-habits.md')
    await openMenu()

    await userEvent.click(page.getByRole('menuitem', { name: /^Open in new window/ }))
    expect(openRouteInNewWindow).toHaveBeenCalledWith({
      kind: 'note',
      path: 'notes/atomic-habits.md',
    })
  })

  it('reflects the note state in the toggle labels', async () => {
    getPinnedNotes.mockResolvedValue([
      { path: 'notes/atomic-habits.md', title: 'Atomic Habits', dailyDate: null, isPrivate: true },
    ])
    getNote.mockResolvedValue({
      path: 'notes/atomic-habits.md',
      title: 'Atomic Habits',
      dailyDate: null,
      isPrivate: true,
    })
    await renderMenu('notes/atomic-habits.md')
    await openMenu()

    await expect.element(page.getByRole('menuitem', { name: /^Un-pin/ })).toBeInTheDocument()
    await expect.element(page.getByRole('menuitem', { name: /^Unlock note/ })).toBeInTheDocument()
  })

  it('never offers to trash a daily note', async () => {
    // Dailies are generated by date and the app recreates them; the delete
    // helper refuses one too, so the entry must not be reachable here either.
    await renderMenu('daily/2026-08-22.md')
    await openMenu()

    await expect.element(page.getByRole('menuitem', { name: /^Pin/ })).toBeInTheDocument()
    expect(page.getByRole('menuitem', { name: /Trash/ }).elements()).toHaveLength(0)
  })

  it('offers trash on a regular note and confirms before deleting', async () => {
    await renderMenu('notes/atomic-habits.md')
    await openMenu()

    await userEvent.click(page.getByRole('menuitem', { name: /Move to Trash/ }))
    // The shared bulk confirm, over a one-note selection.
    await expect.element(page.getByText('Trash 1 note?')).toBeInTheDocument()
  })

  it('reports through the operations toast when no graph is open', async () => {
    // The gesture must never be dead: with no graph the menu still opens and
    // the action says why it did nothing instead of failing silently.
    graph.current = null
    await renderMenu('notes/atomic-habits.md')
    await openMenu()

    await userEvent.click(page.getByRole('menuitem', { name: /^Pin/ }))
    expect(toggleNotePinned).not.toHaveBeenCalled()
    expect(operationFail).toHaveBeenCalledWith('No graph is open.')
  })
})
