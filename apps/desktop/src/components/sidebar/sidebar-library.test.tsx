import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { render } from 'vitest-browser-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryDir, LibraryRoot } from '@reflect/core'
import { SidebarLibrary } from './sidebar-library'

const library = vi.hoisted(() => ({
  roots: [] as LibraryRoot[],
  dirs: new Map<string, LibraryDir | 'error'>(),
}))
const navigateNoteLink = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-library', () => ({
  useLibraryRoots: () => library.roots,
  useLibraryDir: (root: string, dir: string) => library.dirs.get(`${root}:${dir}`) ?? null,
}))
vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => navigateNoteLink,
}))
vi.mock('@/routing/router', () => ({ useRouter: () => ({ route: { kind: 'today' } }) }))

function renderLibrary() {
  return render(
    <DndContext>
      <SortableContext items={['library']}>
        <SidebarLibrary />
      </SortableContext>
    </DndContext>,
  )
}

afterEach(() => {
  library.roots = []
  library.dirs.clear()
  navigateNoteLink.mockReset()
  window.sessionStorage.clear()
})

describe('SidebarLibrary', () => {
  it('says so when a folder cannot be opened', async () => {
    library.roots = [{ id: 'codex', label: 'Codex', path: '/Users/me/.codex' }]
    library.dirs.set('codex:', 'error')
    const view = await renderLibrary()

    await view.getByRole('button', { name: 'Codex' }).click()
    await expect.element(view.getByText('This folder couldn’t be opened')).toBeInTheDocument()
  })

  it('renders nothing when no agent folder exists', async () => {
    const view = await renderLibrary()
    await expect.element(view.getByText('Library')).not.toBeInTheDocument()
  })

  it('expands a folder level by level and opens a file read-only', async () => {
    library.roots = [{ id: 'claude', label: 'Claude Code', path: '/Users/me/.claude' }]
    library.dirs.set('claude:', { folders: ['skills'], files: ['CLAUDE.md'] })
    library.dirs.set('claude:skills', { folders: [], files: ['review.md'] })
    const view = await renderLibrary()

    await view.getByRole('button', { name: 'Claude Code' }).click()
    await expect
      .element(view.getByRole('button', { name: 'CLAUDE', exact: true }))
      .toBeInTheDocument()
    await view.getByRole('button', { name: 'skills' }).click()
    await view.getByRole('button', { name: 'review' }).click()

    expect(navigateNoteLink).toHaveBeenCalledWith({
      target: { kind: 'library', root: 'claude', path: 'skills/review.md' },
      openInSplit: false,
    })
  })

  it('says so when a folder holds no markdown', async () => {
    library.roots = [{ id: 'codex', label: 'Codex', path: '/Users/me/.codex' }]
    library.dirs.set('codex:', { folders: [], files: [] })
    const view = await renderLibrary()

    await view.getByRole('button', { name: 'Codex' }).click()
    await expect.element(view.getByText('No markdown here')).toBeInTheDocument()
  })
})
