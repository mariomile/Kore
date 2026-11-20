import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFolderTree, DEFAULT_SETTINGS, type FolderTreeFolder } from '@kore/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RouterProvider } from '@/routing/router'
import { SidebarFolders } from './sidebar-folders'

const createFolder = vi.hoisted(() => vi.fn(async () => {}))
const moveFolder = vi.hoisted(() => vi.fn(async () => {}))
const deleteFolder = vi.hoisted(() => vi.fn(async () => {}))
const revealFolder = vi.hoisted(() => vi.fn(async () => {}))
const moveIndexedRows = vi.hoisted(() => vi.fn(async () => {}))
const removeFromIndexBatch = vi.hoisted(() => vi.fn(async () => {}))
const getPathLinkSources = vi.hoisted(() => vi.fn(async () => []))
const getFolderTree = vi.hoisted(() => vi.fn<() => Promise<FolderTreeFolder>>())

vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  hasBridge: () => true,
  getFolderTree,
  createFolder,
  moveFolder,
  deleteFolder,
  revealFolder,
  moveIndexedRows,
  removeFromIndexBatch,
  getPathLinkSources,
  getPinnedNotes: async () => [],
  getNote: async () => null,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({
    graph: { root: '/vault', name: 'Vault', generation: 7 },
    indexGeneration: 3,
  }),
}))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({
    settings: DEFAULT_SETTINGS,
    updateSettingsWith: vi.fn(),
  }),
}))

const TREE = buildFolderTree(
  [
    { path: '_inbox/GTA 6.md', title: 'GTA 6' },
    { path: 'Active/Goals/North Star.md', title: 'North Star' },
    { path: 'daily/2026-11-20.md', title: '2026-11-20' },
  ],
  ['Active/Empty'],
)

function renderFolders() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <RouterProvider initialRoute={{ kind: 'today' }}>
          <SidebarFolders />
        </RouterProvider>
      </QueryClientProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  getFolderTree.mockReset().mockResolvedValue(TREE)
  createFolder.mockClear()
  moveFolder.mockClear()
  deleteFolder.mockClear()
  revealFolder.mockClear()
  moveIndexedRows.mockClear()
  removeFromIndexBatch.mockClear()
})

describe('SidebarFolders context menu', () => {
  it('opens the folder context menu and creates a subfolder or renames a folder', async () => {
    const view = await renderFolders()
    const inboxButton = view.getByRole('button', { name: '_inbox 1' })
    await expect.element(inboxButton).toBeVisible()

    // Right-click `_inbox` → New subfolder
    await userEvent.click(inboxButton, { button: 'right' })
    await page.getByRole('menuitem', { name: 'New subfolder…' }).click()
    await page.getByLabelText('Subfolder name').fill('Triage')
    await page.getByRole('button', { name: 'Create' }).click()

    await vi.waitFor(() => expect(createFolder).toHaveBeenCalledWith('_inbox/Triage', 7))

    // Right-click `_inbox` → Rename
    await userEvent.click(inboxButton, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename…' }).click()
    const nameInput = page.getByLabelText('Folder name')
    await nameInput.fill('Inbox')
    await page.getByRole('button', { name: 'Rename' }).click()

    await vi.waitFor(() => expect(moveFolder).toHaveBeenCalledWith('_inbox', 'Inbox', 7))
    expect(moveIndexedRows).toHaveBeenCalledWith('_inbox/GTA 6.md', 'Inbox/GTA 6.md', 3)
  })

  it('protects system folders from rename, move, and trash', async () => {
    const view = await renderFolders()
    const dailyButton = view.getByRole('button', { name: 'daily 1' })
    await expect.element(dailyButton).toBeVisible()

    await userEvent.click(dailyButton, { button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: 'New note…' })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: 'Reveal in Finder' })).toBeVisible()
    expect(page.getByRole('menuitem', { name: 'Rename…' }).query()).toBeNull()
    expect(page.getByRole('menuitem', { name: 'Move to…' }).query()).toBeNull()
    expect(page.getByRole('menuitem', { name: 'Move to Trash…' }).query()).toBeNull()
  })

  it('opens the note context menu when right-clicking a note row inside a folder', async () => {
    const view = await renderFolders()
    await view.getByRole('button', { name: 'Expand _inbox' }).click()
    const noteButton = view.getByRole('button', { name: 'GTA 6' })
    await expect.element(noteButton).toBeVisible()

    await userEvent.click(noteButton, { button: 'right' })
    await expect.element(page.getByRole('menuitem', { name: /Copy note path/ })).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: /Move to Trash/ })).toBeVisible()
  })
})
