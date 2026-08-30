import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { TagDefinitionState } from '@/lib/tags/tag-type-write'
import { TagConfigDialog } from './tag-config-dialog'

const definition = vi.hoisted(() => ({
  current: {
    path: 'tags/book.md',
    exists: false,
    needsConversion: false,
    properties: [],
    template: null,
  } as TagDefinitionState,
}))
const saveTagType = vi.hoisted(() => vi.fn(async () => {}))
const invalidateQueries = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/tags/tag-type-write', () => ({
  readTagDefinition: async () => definition.current,
  saveTagType,
}))
const propertyUses = vi.hoisted(() => ({
  current: [] as { notePath: string; value: unknown }[],
}))
const templates = vi.hoisted(() => ({
  current: [] as { path: string; title: string; mtime: number }[],
}))
const commitNoteFrontmatter = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  listNotesWithProperty: async () => propertyUses.current,
  listTemplates: async () => templates.current,
}))
vi.mock('@/lib/note-frontmatter', () => ({ commitNoteFrontmatter }))
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
    template: null,
  }
  propertyUses.current = []
  templates.current = []
  saveTagType.mockClear()
  invalidateQueries.mockClear()
  commitNoteFrontmatter.mockClear()
})

describe('TagConfigDialog', () => {
  it('shows the stored schema and saves an added property with a derived key', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
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
      null,
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
      template: null,
    }
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await expect.element(view.getByText('Saving converts it', { exact: false })).toBeInTheDocument()
    await expect.element(view.getByRole('button', { name: 'Convert & save' })).toBeEnabled()
  })

  it('renaming a used key offers migration and moves the values on confirm', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
    }
    propertyUses.current = [
      {
        notePath: 'notes/dune.md',
        value: { value: 'Frank Herbert', valueType: 'string', valueNumber: null },
      },
    ]
    const onClose = vi.fn()
    const view = await render(<TagConfigDialog tag="book" onClose={onClose} />)

    // The key editor folds behind its mono chip until asked for.
    await view.getByRole('button', { name: 'Edit frontmatter key' }).click()
    const keyInput = view.getByRole('textbox', { name: 'Frontmatter key' })
    await keyInput.fill('writer')
    await view.getByRole('button', { name: 'Save' }).click()

    // The blast radius surfaces before anything is written.
    await expect.element(view.getByText('author → writer (1 note)')).toBeInTheDocument()
    expect(saveTagType).not.toHaveBeenCalled()

    await view.getByRole('button', { name: 'Save & migrate values' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [{ name: 'Author', key: 'writer', type: 'text' }],
      7,
      null,
    )
    expect(commitNoteFrontmatter).toHaveBeenCalledWith(
      'notes/dune.md',
      { properties: { author: undefined, writer: 'Frank Herbert' } },
      7,
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('renaming a used key can save without migrating — values stay put', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
    }
    propertyUses.current = [
      {
        notePath: 'notes/dune.md',
        value: { value: 'Frank Herbert', valueType: 'string', valueNumber: null },
      },
    ]
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Edit frontmatter key' }).click()
    await view.getByRole('textbox', { name: 'Frontmatter key' }).fill('writer')
    await view.getByRole('button', { name: 'Save' }).click()
    await view.getByRole('button', { name: 'Save without migrating' }).click()

    expect(saveTagType).toHaveBeenCalled()
    expect(commitNoteFrontmatter).not.toHaveBeenCalled()
  })

  it('seeds an empty schema from a preset and the views strip lights up', async () => {
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await view.getByRole('button', { name: /Task board/ }).click()

    const names = view.getByRole('textbox', { name: 'Property name' })
    await expect.element(names.nth(0)).toHaveValue('Status')
    await expect.element(names.nth(2)).toHaveValue('Priority')
    // The preset carries a status and a date, so Board and Calendar light
    // up in the strip — named after the property powering each.
    await expect.element(view.getByText('Board · Status')).toBeInTheDocument()
    await expect.element(view.getByText('Calendar · Due')).toBeInTheDocument()
    // With rows on screen the presets step aside.
    expect(view.getByRole('button', { name: /Task board/ }).query()).toBeNull()

    await view.getByRole('button', { name: 'Save' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [
        {
          name: 'Status',
          key: 'status',
          type: 'status',
          options: ['Backlog', 'In progress', 'Done'],
        },
        { name: 'Due', key: 'due', type: 'date' },
        { name: 'Priority', key: 'priority', type: 'select', options: ['High', 'Medium', 'Low'] },
      ],
      7,
      null,
    )
  })

  it('tells what the dark views still need while the schema cannot power them', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
    }
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    // A lone text property powers the table and nothing else — each dark
    // pill names the property type that would light it.
    await expect.element(view.getByText('Table', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('Board — add a Select or Status')).toBeInTheDocument()
    await expect.element(view.getByText('Calendar — add a Date')).toBeInTheDocument()
  })

  it('edits select options as chips and saves the survivors', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Status', key: 'status', type: 'select', options: ['to-read', 'done'] }],
      template: null,
    }
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await expect.element(view.getByText('to-read')).toBeInTheDocument()
    await view.getByRole('textbox', { name: 'Add option' }).fill('reading')
    await userEvent.keyboard('{Enter}')
    await view.getByRole('button', { name: 'Remove to-read' }).click()

    await view.getByRole('button', { name: 'Save' }).click()
    expect(saveTagType).toHaveBeenCalledWith(
      'book',
      [{ name: 'Status', key: 'status', type: 'select', options: ['done', 'reading'] }],
      7,
      null,
    )
  })

  it('disables save while a row is invalid (duplicate key)', async () => {
    definition.current = {
      path: 'tags/book.md',
      exists: true,
      needsConversion: false,
      properties: [{ name: 'Author', key: 'author', type: 'text' }],
      template: null,
    }
    const view = await render(<TagConfigDialog tag="book" onClose={() => {}} />)

    await view.getByRole('button', { name: 'Add property' }).click()
    const names = view.getByRole('textbox', { name: 'Property name' })
    await names.nth(1).fill('Author')

    await expect.element(view.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(saveTagType).not.toHaveBeenCalled()
  })
})
