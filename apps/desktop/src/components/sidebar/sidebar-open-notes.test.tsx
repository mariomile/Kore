import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenTabItem } from '@/hooks/use-open-tab-items'

/**
 * The sidebar's Open shelf: a collapsible section like Pinned and Tags, whose
 * row list stops at a ceiling so a long session cannot push the shelves below
 * it off the rail — the rest wait behind "Show more".
 */

const tabs = vi.hoisted(() => ({
  items: [] as OpenTabItem[],
  activeTab: null as OpenTabItem['tab'] | null,
}))
const closeTab = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-open-tab-items', () => ({
  useOpenTabItems: () => tabs.items,
}))
vi.mock('@/providers/open-tabs-provider', () => ({
  useOpenTabs: () => ({ activeTab: tabs.activeTab, activateTab: () => {}, closeTab }),
}))

const { SidebarOpenTabs } = await import('./sidebar-open-notes')

function openNotes(count: number): OpenTabItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    tab: { kind: 'note', path: `notes/note-${index}.md`, pinned: false },
    title: `Note ${index}`,
  }))
}

beforeEach(() => {
  window.sessionStorage.clear()
  tabs.items = openNotes(10)
  tabs.activeTab = null
  closeTab.mockClear()
})

describe('SidebarOpenTabs', () => {
  it('caps the rows it lists and reveals the rest behind "Show more"', async () => {
    const view = await render(<SidebarOpenTabs />)

    await expect.element(view.getByRole('button', { name: 'Note 7', exact: true })).toBeVisible()
    expect(view.getByRole('button', { name: 'Note 8', exact: true }).query()).toBeNull()
    expect(view.getByRole('button', { name: 'Note 9', exact: true }).query()).toBeNull()

    await view.getByRole('button', { name: 'Show 2 more' }).click()
    await expect.element(view.getByRole('button', { name: 'Note 9', exact: true })).toBeVisible()

    // And back: the shelf returns to its ceiling.
    await view.getByRole('button', { name: 'Show less' }).click()
    expect(view.getByRole('button', { name: 'Note 9', exact: true }).query()).toBeNull()
    await view.unmount()
  })

  it('lists every tab without a "Show more" while it fits', async () => {
    tabs.items = openNotes(3)
    const view = await render(<SidebarOpenTabs />)

    await expect.element(view.getByRole('button', { name: 'Note 2', exact: true })).toBeVisible()
    expect(view.getByRole('button', { name: /show/i }).query()).toBeNull()
    await view.unmount()
  })

  it('keeps active-row corners inside the disclosure clipping boundary', async () => {
    tabs.items = openNotes(1)
    tabs.activeTab = tabs.items[0]!.tab
    const view = await render(<SidebarOpenTabs />)
    const row = view.getByRole('button', { name: 'Note 0', exact: true }).element()
    const clippingBoundary = row.parentElement?.parentElement?.parentElement?.parentElement
    expect(clippingBoundary).not.toBeNull()

    const rowBounds = row.getBoundingClientRect()
    const boundaryBounds = clippingBoundary!.getBoundingClientRect()
    expect(rowBounds.left).toBeGreaterThanOrEqual(boundaryBounds.left)
    expect(rowBounds.right).toBeLessThanOrEqual(boundaryBounds.right)
    await view.unmount()
  })

  it('collapses like the other shelves, and closes a tab from its row', async () => {
    const view = await render(<SidebarOpenTabs />)
    const shelf = view.getByRole('region', { name: 'Open' })
    await expect.element(shelf).toBeVisible()

    await view.getByRole('button', { name: 'Close Note 0' }).click()
    expect(closeTab).toHaveBeenCalledWith(tabs.items[0]?.tab)

    // The header is the disclosure: collapsed, the shelf keeps its heading and
    // drops its rows.
    await view.getByRole('button', { name: 'Open', exact: true }).click()
    await expect
      .element(view.getByRole('button', { name: 'Open', exact: true }))
      .toHaveAttribute('aria-expanded', 'false')
    await view.unmount()
  })
})
