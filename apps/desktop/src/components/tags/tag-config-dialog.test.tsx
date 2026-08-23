import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TagDefinitionState } from '@/lib/tags/tag-type-write'
import { TagConfigDialog } from './tag-config-dialog'

const definition = vi.hoisted(() => ({
  current: {
    path: 'tags/book.md',
    exists: false,
    needsConversion: false,
    properties: [],
  } as TagDefinitionState,
}))
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))
const invalidateQueries = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/tags/tag-type-write', () => ({
  readTagDefinition: async () => definition.current,
  saveTagType,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', generation: 7 } }),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}))

beforeEach(() => {
  definition.current = {
    path: 'tags/book.md',
    exists: false,
    needsConversion: false,
    properties: [],
  }
  saveTagType.mockClear()
  invalidateQueries.mockClear()
})

describe('TagConfigDialog', () => {
  it('shows the stored schema and saves an added property with a derived key', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
    }
    const onClose = vi.fn()
    const view = await render(<TagConfigDialog tag="Book" onClose={onClose} />)

    await expect.element(view.getByRole('textbox', { name: 'Property name' })).toHaveValue('Author')

    await view.getByRole('button', { name: 'Add property' }).click()
    const names = view.getByRole('textbox', { name: 'Property name' })
    await names.nth(1).fill('Read on')

    await view.getByRole('button', { name: 'Save' }).click()

    expect(saveTagType).toHaveBeenCalledWith(
      'Book',
      [
        { name: 'Author', key: 'author', type: 'text' },
        { name: 'Read on', key: 'read-on', type: 'text' },
      ],
      7,
    )
    expect(invalidateQueries).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('offers conversion when an unmarked note occupies the definition path', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: true,
      properties: [],
    }
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await expect.element(view.getByText('Saving converts it', { exact: false })).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Convert & save' })).toBeEnabled()
  })

  it('disables save while a row is invalid (duplicate key)', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
    }
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Add property' }).click()
    const names = view.getByRole('textbox', { name: 'Property name' })
    await names.nth(1).fill('Author')

    await expect.element(view.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(saveTagType).not.toHaveBeenCalled()
  })
})
