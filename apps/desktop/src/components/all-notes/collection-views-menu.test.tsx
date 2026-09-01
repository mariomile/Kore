import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { SavedCollectionView } from '@reflect/core'
import { CollectionViewsMenu } from './collection-views-menu'

const VIEWS: SavedCollectionView[] = [
  {
    id: 'v1',
    name: 'Reading queue',
    view: 'board',
    sort: null,
    group: 'status',
    tableGroup: null,
    filters: [{ key: 'status', operator: 'is', text: 'to-read' }],
  },
]

describe('CollectionViewsMenu', () => {
  it('applies a saved view and deletes one', async () => {
    const onApply = vi.fn()
    const onDelete = vi.fn()
    const view = await render(
      <CollectionViewsMenu views={VIEWS} onApply={onApply} onSave={() => {}} onDelete={onDelete} />,
    )

    await view.getByRole('button', { name: 'Saved views' }).click()
    await view.getByRole('button', { name: 'Reading queue board' }).click()
    expect(onApply).toHaveBeenCalledWith(VIEWS[0])

    await view.getByRole('button', { name: 'Saved views' }).click()
    await view.getByRole('button', { name: 'Delete view Reading queue' }).click()
    expect(onDelete).toHaveBeenCalledWith('v1')
  })

  it('saves the current lens under a typed name', async () => {
    const onSave = vi.fn()
    const view = await render(
      <CollectionViewsMenu views={[]} onApply={() => {}} onSave={onSave} onDelete={() => {}} />,
    )

    await view.getByRole('button', { name: 'Saved views' }).click()
    await view.getByRole('textbox', { name: 'View name' }).fill('My shelf')
    await view.getByRole('button', { name: 'Save view' }).click()
    expect(onSave).toHaveBeenCalledWith('My shelf')
  })
})
