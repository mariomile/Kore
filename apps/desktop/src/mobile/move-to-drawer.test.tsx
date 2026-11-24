import type { ReactNode } from 'react'
import { cleanup, render } from 'vitest-browser-react'
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
vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: vi.fn() }))

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

afterEach(() => {
  cleanup()
  moveTo.mockClear()
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
})
