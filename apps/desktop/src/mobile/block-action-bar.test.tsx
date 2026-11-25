import type { ReactNode } from 'react'
import { cleanup, render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockSelection, BlockSelectionState } from '@/editor/block-selection-store'
import { MobileBlockActionBar } from './block-action-bar'

/**
 * The bar that stands in for the tab bar while blocks are selected: one row
 * of labelled verbs and a round Done, the count only once there are two or
 * more, and the up and down steps inside the Turn into sheet.
 */

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DrawerBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/providers/settings-provider', () => ({
  useSettings: () => ({ settings: { dateFormat: 'MMM d' } }),
}))

function selection(state: Partial<BlockSelectionState> = {}): BlockSelection {
  return {
    state: {
      count: 1,
      kind: 'text',
      canIndent: false,
      canOutdent: false,
      canMoveUp: true,
      canMoveDown: true,
      date: null,
      isPage: false,
      hasPage: false,
      ...state,
    },
    commands: {
      setKind: vi.fn(),
      remind: vi.fn(),
      indent: vi.fn(),
      outdent: vi.fn(),
      moveUp: vi.fn(),
      moveDown: vi.fn(),
      duplicate: vi.fn(),
      copy: vi.fn(async () => {}),
      remove: vi.fn(),
      zoom: vi.fn(),
      makePage: vi.fn(),
      moveToNote: vi.fn(),
      askAi: vi.fn(),
      clear: vi.fn(),
    },
  }
}

afterEach(() => {
  cleanup()
})

describe('MobileBlockActionBar', () => {
  it('shows one row of verbs and a Done without a count for one block', async () => {
    const current = selection()
    await render(<MobileBlockActionBar selection={current} />)
    const toolbar = page.getByRole('toolbar', { name: 'Block actions' })
    for (const verb of ['Turn into', 'Date', 'Move', 'Zoom', 'Ask AI', 'Delete']) {
      await expect.element(toolbar.getByRole('button', { name: verb })).toBeVisible()
    }
    // The arrows left the bar: they live in the Turn into sheet.
    expect(page.getByRole('button', { name: 'Move up' }).elements()).toHaveLength(0)
    const done = page.getByRole('button', { name: 'Done, 1 block selected' })
    await expect.element(done).toBeVisible()
    expect(done.element().textContent).toBe('')
    await done.click()
    expect(current.commands.clear).toHaveBeenCalledOnce()
  })

  it('counts two or more blocks on Done', async () => {
    await render(<MobileBlockActionBar selection={selection({ count: 3 })} />)
    const done = page.getByRole('button', { name: 'Done, 3 blocks selected' })
    await expect.element(done).toHaveTextContent('3')
  })

  it('steps a block up and down from the Turn into sheet, which stays open', async () => {
    const current = selection({ canMoveDown: false })
    await render(<MobileBlockActionBar selection={current} />)
    await page.getByRole('button', { name: 'Turn into' }).click()
    await expect.element(page.getByRole('button', { name: 'Move down' })).toBeDisabled()
    await page.getByRole('button', { name: 'Move up' }).click()
    expect(current.commands.moveUp).toHaveBeenCalledOnce()
    await expect.element(page.getByRole('button', { name: 'Move up' })).toBeVisible()
  })
})
