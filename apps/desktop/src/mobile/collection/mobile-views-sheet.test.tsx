import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { SavedCollectionView } from '@kore/core'
import { MobileViewsSheet } from './mobile-views-sheet'

vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))

const VIEWS: SavedCollectionView[] = [
  {
    id: 'v1',
    name: 'All projects',
    view: 'table',
    sorts: [],
    group: null,
    tableGroup: null,
    match: 'all',
    filters: [],
  },
  {
    id: 'v2',
    name: 'By status',
    view: 'board',
    sorts: [],
    group: 'status',
    tableGroup: null,
    match: 'all',
    filters: [],
  },
]

describe('MobileViewsSheet', () => {
  it('switches views and creates a new view from the dedicated New view flow', async () => {
    const onSelect = vi.fn()
    const onAdd = vi.fn()
    const view = await render(
      <MobileViewsSheet
        open
        onOpenChange={() => {}}
        tabs={VIEWS}
        activeTabId="v1"
        layouts={['table', 'board', 'gallery']}
        onSelect={onSelect}
        onAdd={onAdd}
        onRename={() => {}}
        onChangeLayout={() => {}}
        onDelete={() => {}}
      />,
    )

    await expect.element(view.getByText('2 views')).toBeVisible()
    await userEvent.click(view.getByRole('option', { name: 'By status' }))
    expect(onSelect).toHaveBeenCalledWith(VIEWS[1])

    await userEvent.click(view.getByRole('button', { name: /New view/ }))
    await userEvent.click(view.getByRole('button', { name: /^Grid/ }))
    expect(onAdd).toHaveBeenCalledWith('grid')
  })

  it('renames, switches layout, and deletes a saved view from its options page', async () => {
    const onRename = vi.fn()
    const onChangeLayout = vi.fn()
    const onDelete = vi.fn()
    const view = await render(
      <MobileViewsSheet
        open
        onOpenChange={() => {}}
        tabs={VIEWS}
        activeTabId="v1"
        layouts={['table', 'board', 'gallery']}
        onSelect={() => {}}
        onAdd={() => {}}
        onRename={onRename}
        onChangeLayout={onChangeLayout}
        onDelete={onDelete}
      />,
    )

    await userEvent.click(view.getByRole('button', { name: 'Options for All projects' }))
    await userEvent.click(view.getByRole('button', { name: 'Board', exact: true }))
    expect(onChangeLayout).toHaveBeenCalledWith('v1', 'board')

    await view.getByRole('textbox', { name: 'View name' }).fill('Active projects')
    await userEvent.click(view.getByRole('button', { name: 'Save' }))
    expect(onRename).toHaveBeenCalledWith('v1', 'Active projects')

    await userEvent.click(view.getByRole('button', { name: 'Options for All projects' }))
    await userEvent.click(view.getByRole('button', { name: 'Delete view' }))
    expect(onDelete).toHaveBeenCalledWith('v1')
  })
})
