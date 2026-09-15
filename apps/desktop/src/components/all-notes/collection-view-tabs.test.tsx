import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { mouse } from 'vitest-browser-commands/playwright'
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

function noop(): void {}

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
        onAdd={noop}
        onDelete={onDelete}
        onMove={noop}
        onShift={noop}
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
        onSelect={noop}
        onAdd={onAdd}
        onDelete={noop}
        onMove={noop}
        onShift={noop}
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
        onSelect={noop}
        onAdd={onAdd}
        onDelete={noop}
        onMove={noop}
        onShift={noop}
      />,
    )

    await view.getByRole('button', { name: 'Add a view' }).click()
    await expect.element(view.getByRole('menuitem', { name: 'Board' })).toBeDisabled()
    await expect.element(view.getByRole('menuitem', { name: 'Calendar' })).toBeDisabled()
    await view.getByRole('menuitem', { name: 'Grid' }).click()
    expect(onAdd).toHaveBeenCalledWith('grid')
    await view.unmount()
  })

  it('nudges a focused tab with Alt+Arrow and keeps a plain click a click', async () => {
    const onSelect = vi.fn()
    const onShift = vi.fn()
    const view = await render(
      <CollectionViewTabs
        tabs={[TABLE, BOARD]}
        activeViewId="v1"
        boardAvailable
        calendarAvailable={false}
        onSelect={onSelect}
        onAdd={noop}
        onDelete={noop}
        onMove={noop}
        onShift={onShift}
      />,
    )

    const board = view.getByRole('tab', { name: 'Board' })
    ;(board.element() as HTMLElement).focus()
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(onShift).toHaveBeenCalledWith('v2', 'left')
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(onShift).toHaveBeenCalledWith('v2', 'right')
    // A bare arrow is not a move.
    await userEvent.keyboard('{ArrowLeft}')
    expect(onShift).toHaveBeenCalledTimes(2)
    // The pill is its own drag handle, yet a click still selects.
    await board.click()
    expect(onSelect).toHaveBeenCalledWith(BOARD)
    await view.unmount()
  })

  it('drops a dragged tab onto its neighbour', async () => {
    const onMove = vi.fn()
    const view = await render(
      <CollectionViewTabs
        tabs={[TABLE, BOARD]}
        activeViewId="v1"
        boardAvailable
        calendarAvailable={false}
        onSelect={noop}
        onAdd={noop}
        onDelete={noop}
        onMove={onMove}
        onShift={noop}
      />,
    )

    const from = view.getByRole('tab', { name: 'Board' }).element().getBoundingClientRect()
    const to = view.getByRole('tab', { name: 'Table' }).element().getBoundingClientRect()
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await mouse.down()
    // Past the 4px activation distance first, then onto the target in steps
    // so the sortable context sees the pointer travel.
    await mouse.move(from.x + from.width / 2 - 8, from.y + from.height / 2, { steps: 2 })
    await mouse.move(to.x + 4, to.y + to.height / 2, { steps: 8 })
    await mouse.up()

    await vi.waitFor(() => expect(onMove).toHaveBeenCalledWith('v2', 'v1'))
    await view.unmount()
  })
})
