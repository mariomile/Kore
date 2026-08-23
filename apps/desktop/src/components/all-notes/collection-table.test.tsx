import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, TagType } from '@reflect/core'
import type { ListSelection } from '@/lib/selection/use-list-selection'
import { CollectionTable } from './collection-table'

vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { uiDensity: 'default', dateFormat: 'mdy', timeFormat: '12h' },
    updateSettings: vi.fn(),
  }),
}))
const commitProperty = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
}))

const clickSelect = vi.fn()

function selection(selectedPaths: readonly string[] = []): ListSelection {
  const selected = new Set(selectedPaths)
  return {
    selected,
    selectedCount: selected.size,
    isSelected: (key) => selected.has(key),
    isSoleSelected: (key) => selected.size === 1 && selected.has(key),
    clickSelect,
    select: vi.fn(),
    selectAll: vi.fn(),
    clear: vi.fn(),
    move: vi.fn(),
    extend: vi.fn(),
    activeKey: () => null,
  }
}

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Rating', key: 'rating', type: 'number' },
    { name: 'Read', key: 'read', type: 'checkbox' },
  ],
}

const ENTRIES: CollectionEntry[] = [
  {
    path: 'notes/dispossessed.md',
    title: 'The Dispossessed',
    mtime: new Date(2020, 0, 15).getTime(),
    isPinned: false,
    properties: {
      author: { value: 'Le Guin', valueType: 'string', valueNumber: null },
      rating: { value: '4.5', valueType: 'number', valueNumber: 4.5 },
      read: { value: 'true', valueType: 'boolean', valueNumber: null },
    },
  },
  {
    path: 'notes/dune.md',
    title: 'Dune',
    mtime: new Date(2020, 0, 10).getTime(),
    isPinned: false,
    // `rating` holds a string under a number column — the mismatch case.
    properties: {
      rating: { value: 'five', valueType: 'string', valueNumber: null },
    },
  },
]

beforeEach(() => {
  clickSelect.mockClear()
  commitProperty.mockClear()
})

describe('CollectionTable', () => {
  it('renders one column per schema property and the stored values', async () => {
    const view = await render(
      <CollectionTable
        entries={ENTRIES}
        tag="book"
        type={BOOK_TYPE}
        selection={selection()}
        sort={null}
        onSortChange={() => {}}
        onOpen={() => {}}
        registerScrollToIndex={() => {}}
      />,
    )

    await expect.element(view.getByRole('button', { name: 'Sort by Author' })).toBeInTheDocument()
    await expect.element(view.getByText('Le Guin')).toBeInTheDocument()
    await expect.element(view.getByText('4.5')).toBeInTheDocument()
    await expect.element(view.getByLabelText('Checked', { exact: true })).toBeInTheDocument()
    // Dune's missing author renders an empty cell, its unread box unchecked.
    await expect.element(view.getByLabelText('Unchecked', { exact: true })).toBeInTheDocument()
  })

  it('shows a mismatched value raw with the warning tint', async () => {
    const view = await render(
      <CollectionTable
        entries={ENTRIES}
        tag="book"
        type={BOOK_TYPE}
        selection={selection()}
        sort={null}
        onSortChange={() => {}}
        onOpen={() => {}}
        registerScrollToIndex={() => {}}
      />,
    )

    const mismatch = view.getByText('five')
    await expect.element(mismatch).toBeInTheDocument()
    await expect
      .element(mismatch)
      .toHaveAttribute('title', 'Value does not match the property type')
  })

  it('cycles a property sort asc → desc → off', async () => {
    const onSortChange = vi.fn()
    const view = await render(
      <CollectionTable
        entries={ENTRIES}
        tag="book"
        type={BOOK_TYPE}
        selection={selection()}
        sort={null}
        onSortChange={onSortChange}
        onOpen={() => {}}
        registerScrollToIndex={() => {}}
      />,
    )
    await view.getByRole('button', { name: /Sort by Rating/ }).click()
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'rating', direction: 'asc' })
    await view.unmount()

    const ascending = await render(
      <CollectionTable
        entries={ENTRIES}
        tag="book"
        type={BOOK_TYPE}
        selection={selection()}
        sort={{ key: 'rating', direction: 'asc' }}
        onSortChange={onSortChange}
        onOpen={() => {}}
        registerScrollToIndex={() => {}}
      />,
    )
    await ascending.getByRole('button', { name: /Sort by Rating/ }).click()
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'rating', direction: 'desc' })
    await ascending.unmount()

    const descending = await render(
      <CollectionTable
        entries={ENTRIES}
        tag="book"
        type={BOOK_TYPE}
        selection={selection()}
        sort={{ key: 'rating', direction: 'desc' }}
        onSortChange={onSortChange}
        onOpen={() => {}}
        registerScrollToIndex={() => {}}
      />,
    )
    await descending.getByRole('button', { name: /Sort by Rating/ }).click()
    expect(onSortChange).toHaveBeenLastCalledWith(null)
  })

  it('opens a note from its subject and an editor from a property cell', async () => {
    const onOpen = vi.fn()
    const view = await render(
      <CollectionTable
        entries={ENTRIES}
        tag="book"
        type={BOOK_TYPE}
        selection={selection()}
        sort={null}
        onSortChange={() => {}}
        onOpen={onOpen}
        registerScrollToIndex={() => {}}
      />,
    )
    await view.getByRole('button', { name: 'Dune' }).click()
    expect(onOpen).toHaveBeenCalledWith('notes/dune.md', expect.anything())

    // A property cell click belongs to its editor, not the row selection —
    // rows still select through the gutter indicator and keyboard.
    await view.getByText('Le Guin').click()
    await expect.element(view.getByRole('textbox', { name: 'Author' })).toBeInTheDocument()
    expect(clickSelect).not.toHaveBeenCalled()

    // Editing writes through the shared property commit.
    await view.getByRole('textbox', { name: 'Author' }).fill('U. K. Le Guin')
    await userEvent.keyboard('{Enter}')
    expect(commitProperty).toHaveBeenCalledWith('notes/dispossessed.md', 'author', 'U. K. Le Guin')
  })
})
