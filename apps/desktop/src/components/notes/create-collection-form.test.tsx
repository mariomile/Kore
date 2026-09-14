import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { CreateCollectionForm } from './create-collection-form'

const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/reusable-collection-write', () => ({
  createReusableCollectionDefinition: create,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 1 } }),
}))

beforeEach(() => create.mockReset())

describe('inline collection creation', () => {
  it('creates an empty untagged collection from its name without a dialog', async () => {
    const definition = { path: 'notes/travel.md' }
    create.mockResolvedValue(definition)
    const onCreated = vi.fn()
    const view = await render(<CreateCollectionForm onCreated={onCreated} onCancel={vi.fn()} />)

    expect(view.getByRole('dialog').query()).toBeNull()
    await expect.element(view.getByRole('button', { name: 'Create collection' })).toBeDisabled()
    await view.getByRole('textbox', { name: 'Collection name' }).fill('Travel')
    await view.getByRole('button', { name: 'Create collection' }).click()

    expect(create).toHaveBeenCalledWith(
      'Travel',
      { version: 1, sources: { tags: [], include: [], exclude: [] } },
      1,
    )
    expect(onCreated).toHaveBeenCalledWith(definition)
    await view.getByRole('button', { name: 'Create collection' }).click()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps the name and reports a failed save without navigating away', async () => {
    create.mockRejectedValueOnce(new Error('Could not save'))
    const onCreated = vi.fn()
    const view = await render(<CreateCollectionForm onCreated={onCreated} onCancel={vi.fn()} />)

    await view.getByRole('textbox', { name: 'Collection name' }).fill('Travel')
    await view.getByRole('button', { name: 'Create collection' }).click()

    await expect.element(view.getByRole('alert')).toHaveTextContent('Could not save')
    await expect.element(view.getByRole('textbox')).toHaveValue('Travel')
    await expect.element(view.getByRole('button', { name: 'Create collection' })).toBeEnabled()
    expect(onCreated).not.toHaveBeenCalled()
  })
})
