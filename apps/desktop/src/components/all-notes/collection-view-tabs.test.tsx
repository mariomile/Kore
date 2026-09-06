import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { SavedCollectionView } from '@reflect/core'
import { CollectionViewTabs } from './collection-view-tabs'

const TABLE: SavedCollectionView = {
  id: 'v1',
  name: 'Table',
  view: 'table',
  sorts: [],
  match: 'all',
  group: null,
  tableGroup: null,
  filters: [],
}

const BOARD: SavedCollectionView = {
  id: 'v2',
  name: 'Board',
  view: 'board',
  sorts: [],
  match: 'all',
  group: 'status',
  tableGroup: null,
  filters: [],
}

describe('CollectionViewTabs', () => {
  it('selects a tab and deletes one when more than one exists', async () => {
    const onSelect = vi.fn()
    const onDelete = vi.fn()
    const view = await render(
      <CollectionViewTabs
        tabs={[TABLE, BOARD]}
        activeViewId="v1"
        boardAvailable
        calendarAvailable={false}
        onSelect={onSelect}
        onAdd={() => {}}
        onDelete={onDelete}
      />,
    )

    await view.getByRole('tab', { name: 'Board' }).click()
    expect(onSelect).toHaveBeenCalledWith(BOARD)

    await view.getByRole('button', { name: 'Delete view Board' }).click()
    expect(onDelete).toHaveBeenCalledWith('v2')
    await view.unmount()
  })

  it('hides delete on the only tab and adds a board from the plus menu', async () => {
    const onAdd = vi.fn()
    const view = await render(
      <CollectionViewTabs
        tabs={[TABLE]}
        activeViewId="v1"
        boardAvailable
        calendarAvailable={false}
        onSelect={() => {}}
        onAdd={onAdd}
        onDelete={() => {}}
      />,
    )

    expect(view.getByRole('button', { name: 'Delete view Table' }).query()).toBeNull()
    await view.getByRole('button', { name: 'Add a view' }).click()
    await view.getByRole('menuitem', { name: 'Board' }).click()
    expect(onAdd).toHaveBeenCalledWith('board')
    await view.unmount()
  })

  it('disables Board and Calendar when the schema cannot support them', async () => {
    const onAdd = vi.fn()
    const view = await render(
      <CollectionViewTabs
        tabs={[TABLE]}
        activeViewId="v1"
        boardAvailable={false}
        calendarAvailable={false}
        onSelect={() => {}}
        onAdd={onAdd}
        onDelete={() => {}}
      />,
    )

    await view.getByRole('button', { name: 'Add a view' }).click()
    await expect.element(view.getByRole('menuitem', { name: 'Board' })).toBeDisabled()
    await expect.element(view.getByRole('menuitem', { name: 'Calendar' })).toBeDisabled()
    await view.getByRole('menuitem', { name: 'Grid' }).click()
    expect(onAdd).toHaveBeenCalledWith('grid')
    await view.unmount()
  })
})
