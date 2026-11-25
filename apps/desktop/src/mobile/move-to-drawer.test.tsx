import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render as renderPage } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderTreeFolder } from '@kore/core'
import { MoveToDrawer } from './move-to-drawer'

/**
 * The iPhone's Move to… sheet: the vault's folders, the current one checked,
 * a new folder offered for a typed path, and the pick handed to the shared
 * folder operations.
 */

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DrawerBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

function folder(path: string, folders: FolderTreeFolder[] = []): FolderTreeFolder {
  return { path, name: path.split('/').at(-1) ?? '', folders, notes: [], noteCount: 0 }
}
const tree = folder('', [folder('CRM', [folder('CRM/People'), folder('CRM/Companies')])])
vi.mock('@/hooks/use-folder-tree', () => ({ useFolderTree: () => tree }))

const moveTo = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/folders/use-folder-operations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFolderOperations: () => ({ moveTo }),
}))

vi.mock('@/providers/graph-provider', () => ({ useGraph: () => ({ graph: { root: '/vault' } }) }))
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  typeFoldersForNote: async (path: string) => (path === 'Inbox/Ada.md' ? ['CRM/People'] : []),
}))

function render(ui: ReactElement): ReturnType<typeof renderPage> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderPage(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  moveTo.mockClear()
  localStorage.removeItem('kore.recentMoveDestinations')
})

describe('MoveToDrawer', () => {
  it('checks the note’s folder and moves it into the picked one', async () => {
    const onClose = vi.fn()
    await render(
      <MoveToDrawer target={{ kind: 'note', path: 'CRM/People/Ada.md' }} onClose={onClose} />,
    )
    await expect
      .element(page.getByRole('button', { name: /^People/ }))
      .toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: /^Companies/ }).click()
    expect(onClose).toHaveBeenCalled()
    expect(moveTo).toHaveBeenCalledWith(
      { kind: 'note', path: 'CRM/People/Ada.md' },
      'CRM/Companies',
    )
  })

  it('offers a typed path as a new folder, and never a folder inside the one moving', async () => {
    await render(<MoveToDrawer target={{ kind: 'folder', path: 'CRM' }} onClose={() => {}} />)
    await expect.element(page.getByRole('button', { name: /^People/ })).not.toBeInTheDocument()
    await page.getByPlaceholder('Find or create a folder…').fill('Archive/2026')
    await page.getByRole('button', { name: 'New folder “Archive/2026”' }).click()
    expect(moveTo).toHaveBeenCalledWith({ kind: 'folder', path: 'CRM' }, 'Archive/2026')
  })

  it('suggests the note’s type folder, then this vault’s existing latest destinations, and remembers a pick', async () => {
    localStorage.setItem(
      'kore.recentMoveDestinations',
      JSON.stringify({ '/vault': ['Gone', 'CRM', 'CRM/People'], '/other': ['CRM/Companies'] }),
    )
    await render(
      <MoveToDrawer target={{ kind: 'note', path: 'Inbox/Ada.md' }} onClose={() => {}} />,
    )
    const suggested = page.getByRole('list', { name: 'Suggested folders' })
    await expect.element(suggested.getByRole('button').first()).toHaveTextContent('PeopleCRM')
    await expect.element(suggested.getByRole('button').nth(1)).toHaveTextContent('CRM')
    expect(suggested.getByRole('button').all()).toHaveLength(2)
    await suggested.getByRole('button').nth(1).click()
    expect(moveTo).toHaveBeenCalledWith({ kind: 'note', path: 'Inbox/Ada.md' }, 'CRM')
    expect(JSON.parse(localStorage.getItem('kore.recentMoveDestinations') ?? '{}')).toEqual({
      '/vault': ['CRM', 'Gone', 'CRM/People'],
      '/other': ['CRM/Companies'],
    })
  })
})
