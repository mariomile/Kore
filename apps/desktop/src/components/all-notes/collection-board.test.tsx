import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, TagType } from '@reflect/core'
import { boardColumns, boardProperty, CollectionBoard } from './collection-board'

const commitProperty = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
}))

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Status', key: 'status', type: 'select', options: ['to-read', 'reading', 'done'] },
  ],
}

function entry(path: string, title: string, status: string | null): CollectionEntry {
  return {
    path,
    title,
    mtime: 1_750_000_000_000,
    isPinned: false,
    properties:
      status === null ? {} : { status: { value: status, valueType: 'string', valueNumber: null } },
  }
}

const ENTRIES: CollectionEntry[] = [
  entry('notes/dispossessed.md', 'The Dispossessed', 'done'),
  entry('notes/dune.md', 'Dune', 'to-read'),
  entry('notes/lathe.md', 'The Lathe of Heaven', null),
  // A stored value the schema no longer declares still gets a lane.
  entry('notes/stray.md', 'Stray', 'abandoned'),
]

beforeEach(() => {
  commitProperty.mockClear()
})

describe('boardProperty', () => {
  it('picks the first select property, or null without one', () => {
    expect(boardProperty(BOOK_TYPE)?.key).toBe('status')
    expect(boardProperty({ properties: [BOOK_TYPE.properties[0]!] })).toBeNull()
  })
})

describe('boardColumns', () => {
  it('keeps option order, appends stray values, and ends with the unset lane', () => {
    const columns = boardColumns(ENTRIES, boardProperty(BOOK_TYPE)!)
    expect(columns.map((column) => column.label)).toEqual([
      'to-read',
      'reading',
      'done',
      'abandoned',
      'No Status',
    ])
    expect(columns[1]?.entries).toEqual([])
    expect(columns[4]?.entries.map((row) => row.path)).toEqual(['notes/lathe.md'])
  })
})

describe('CollectionBoard', () => {
  it('renders a lane per status with its cards, and opens a note from its card', async () => {
    const onOpen = vi.fn()
    const view = await render(
      <CollectionBoard entries={ENTRIES} property={boardProperty(BOOK_TYPE)!} onOpen={onOpen} />,
    )

    await expect
      .element(view.getByRole('region', { name: 'done', exact: true }))
      .toBeInTheDocument()
    await expect.element(view.getByRole('region', { name: 'No Status' })).toBeInTheDocument()
    await view.getByRole('button', { name: 'Dune' }).click()
    expect(onOpen).toHaveBeenCalledWith('notes/dune.md', expect.anything())
  })

  it('changes a card status through the select editor', async () => {
    const view = await render(
      <CollectionBoard
        entries={[ENTRIES[1]!]}
        property={boardProperty(BOOK_TYPE)!}
        onOpen={() => {}}
      />,
    )

    await view.getByRole('button', { name: 'Edit Status' }).click()
    await view.getByRole('option', { name: 'reading' }).click()
    expect(commitProperty).toHaveBeenCalledWith('notes/dune.md', 'status', 'reading')
  })
})
