import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@reflect/core'
import {
  boardColumns,
  boardProperty,
  CollectionBoard,
  groupableProperties,
  rankForInsertion,
} from './collection-board'

const commitProperties = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperties: () => commitProperties,
}))
const createNoteIfAbsent = vi.hoisted(() => vi.fn(async () => ({ kind: 'created' })))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  createNoteIfAbsent,
}))
vi.mock('@/providers/graph-provider', () => ({
  useGraph: () => ({ graph: { root: '/g', name: 'g', generation: 7 } }),
}))

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Status', key: 'status', type: 'select', options: ['to-read', 'reading', 'done'] },
    { name: 'Read', key: 'read', type: 'checkbox' },
    { name: 'Series', key: 'series', type: 'relation' },
  ],
}
const STATUS = boardProperty(BOOK_TYPE)!

function stored(value: string, valueType: CollectionValue['valueType']): CollectionValue {
  return { value, valueType, valueNumber: valueType === 'number' ? Number(value) : null }
}

function entry(
  path: string,
  title: string,
  properties: Record<string, CollectionValue> = {},
): CollectionEntry {
  return { path, title, mtime: 1_750_000_000_000, isPinned: false, properties }
}

const ENTRIES: CollectionEntry[] = [
  entry('notes/dispossessed.md', 'The Dispossessed', { status: stored('done', 'string') }),
  entry('notes/dune.md', 'Dune', { status: stored('to-read', 'string') }),
  entry('notes/lathe.md', 'The Lathe of Heaven'),
  // A stored value the schema no longer declares still gets a lane.
  entry('notes/stray.md', 'Stray', { status: stored('abandoned', 'string') }),
]

beforeEach(() => {
  commitProperties.mockClear()
  createNoteIfAbsent.mockClear()
})

describe('groupableProperties / boardProperty', () => {
  it('offers select, checkbox, and relation — first one is the default', () => {
    expect(groupableProperties(BOOK_TYPE).map((property) => property.key)).toEqual([
      'status',
      'read',
      'series',
    ])
    expect(boardProperty(BOOK_TYPE)?.key).toBe('status')
    expect(boardProperty({ properties: [BOOK_TYPE.properties[0]!] })).toBeNull()
  })
})

describe('boardColumns', () => {
  it('keeps option order, appends stray values, and ends with the unset lane', () => {
    const columns = boardColumns(ENTRIES, STATUS)
    expect(columns.map((column) => column.label)).toEqual([
      'to-read',
      'reading',
      'done',
      'abandoned',
      'No Status',
    ])
    expect(columns[1]?.entries).toEqual([])
    expect(columns[4]?.entries.map((row) => row.path)).toEqual(['notes/lathe.md'])
    expect(columns[0]?.commit).toBe('to-read')
    expect(columns[4]?.commit).toBeNull()
  })

  it('sorts each lane by the manual order rank, unranked last', () => {
    const ranked = [
      entry('notes/a.md', 'A', { status: stored('done', 'string') }),
      entry('notes/b.md', 'B', { status: stored('done', 'string'), order: stored('2', 'number') }),
      entry('notes/c.md', 'C', { status: stored('done', 'string'), order: stored('1', 'number') }),
    ]
    const done = boardColumns(ranked, STATUS).find((column) => column.label === 'done')!
    expect(done.entries.map((row) => row.title)).toEqual(['C', 'B', 'A'])
  })

  it('groups a checkbox into checked / everything-else lanes', () => {
    const read = BOOK_TYPE.properties[2]!
    const rows = [
      entry('notes/a.md', 'A', { read: stored('true', 'boolean') }),
      entry('notes/b.md', 'B', { read: stored('false', 'boolean') }),
      entry('notes/c.md', 'C'),
    ]
    const columns = boardColumns(rows, read)
    expect(columns.map((column) => column.label)).toEqual(['Read ✓', 'No Read'])
    expect(columns[0]?.entries.map((row) => row.title)).toEqual(['A'])
    expect(columns[1]?.entries.map((row) => row.title)).toEqual(['B', 'C'])
    expect(columns[0]?.commit).toBe(true)
    expect(columns[1]?.commit).toBe(false)
  })

  it('groups a relation into one alphabetical lane per target in use', () => {
    const series = BOOK_TYPE.properties[3]!
    const rows = [
      entry('notes/a.md', 'A', { series: stored('[[Hainish Cycle|Hainish]]', 'string') }),
      entry('notes/b.md', 'B', { series: stored('[[Dune Saga]]', 'string') }),
      entry('notes/c.md', 'C'),
    ]
    const columns = boardColumns(rows, series)
    expect(columns.map((column) => column.label)).toEqual(['Dune Saga', 'Hainish', 'No Series'])
    // The lane commits the stored raw link, alias included.
    expect(columns[1]?.commit).toBe('[[Hainish Cycle|Hainish]]')
  })
})

describe('rankForInsertion', () => {
  const ranked = (rank: number | null, path: string): CollectionEntry =>
    entry(path, path, rank === null ? {} : { order: stored(String(rank), 'number') })

  it('midpoints between ranked neighbours and extends past the edges', () => {
    const lane = [ranked(1, 'a'), ranked(3, 'b'), ranked(5, 'c')]
    expect(rankForInsertion(lane, 0)).toBe(0)
    expect(rankForInsertion(lane, 1)).toBe(2)
    expect(rankForInsertion(lane, 3)).toBe(6)
  })

  it('handles unranked lanes: only "make it first" is expressible', () => {
    const lane = [ranked(null, 'a'), ranked(null, 'b')]
    expect(rankForInsertion(lane, 0)).toBe(0)
    expect(rankForInsertion(lane, 1)).toBeNull()
    expect(rankForInsertion([], 0)).toBeNull()
  })
})

/** Native HTML5 drag as the browser fires it: dragstart on the card, then
 * dragover + drop on the target. Ticks between steps let React commit the
 * drag state each handler reads. */
async function dragTo(card: Element, target: Element): Promise<void> {
  const dataTransfer = new DataTransfer()
  const tick = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, 0))
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
  await tick()
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
  await tick()
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  card.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
  await tick()
}

function renderBoard(entries: CollectionEntry[], onOpen: (path: string) => void = () => {}) {
  return render(
    <div style={{ height: '100vh' }}>
      <CollectionBoard entries={entries} tag="book" property={STATUS} onOpen={onOpen} />
    </div>,
  )
}

/** The card element for a title — awaited, since lanes virtualize and the
 * items mount a measurement tick after the first render. */
async function card(
  view: Awaited<ReturnType<typeof renderBoard>>,
  title: string,
): Promise<Element> {
  const button = view.getByRole('button', { name: title })
  await expect.element(button).toBeInTheDocument()
  return button.element().closest('article')!
}

describe('CollectionBoard', () => {
  it('renders lanes with dots and cards, and opens a note from its card', async () => {
    const onOpen = vi.fn()
    const view = await renderBoard(ENTRIES, onOpen)

    await expect
      .element(view.getByRole('region', { name: 'done', exact: true }))
      .toBeInTheDocument()
    await expect.element(view.getByRole('region', { name: 'No Status' })).toBeInTheDocument()
    await view.getByRole('button', { name: 'Dune' }).click()
    expect(onOpen).toHaveBeenCalledWith('notes/dune.md', expect.anything())
  })

  it('drags a card into another lane: one commit, and the card moves at once', async () => {
    const view = await renderBoard(ENTRIES)
    const lane = view.getByRole('region', { name: 'done', exact: true }).element()

    await dragTo(await card(view, 'Dune'), lane)

    expect(commitProperties).toHaveBeenCalledWith('notes/dune.md', { status: 'done' })
    const done = view.getByRole('region', { name: 'done', exact: true })
    await expect.element(done.getByRole('button', { name: 'Dune' })).toBeInTheDocument()
  })

  it('dropping onto a card takes its position: lane value plus midpoint rank', async () => {
    const rows = [
      entry('notes/a.md', 'A', { status: stored('done', 'string'), order: stored('1', 'number') }),
      entry('notes/b.md', 'B', { status: stored('done', 'string'), order: stored('3', 'number') }),
      entry('notes/dune.md', 'Dune', { status: stored('to-read', 'string') }),
    ]
    const view = await renderBoard(rows)

    await dragTo(await card(view, 'Dune'), await card(view, 'B'))

    expect(commitProperties).toHaveBeenCalledWith('notes/dune.md', { status: 'done', order: 2 })
    // Optimistically the card sits between A and B.
    const done = view.getByRole('region', { name: 'done', exact: true }).element()
    const titles = [...done.querySelectorAll('article button')].map((node) => node.textContent)
    expect(titles.filter((title) => title !== '—')).toContain('Dune')
  })

  it('dropping on the unset lane clears the property', async () => {
    const view = await renderBoard(ENTRIES)
    const lane = view.getByRole('region', { name: 'No Status' }).element()

    await dragTo(await card(view, 'Dune'), lane)

    expect(commitProperties).toHaveBeenCalledWith('notes/dune.md', { status: undefined })
  })

  it('a drop into the card’s own lane background writes nothing', async () => {
    const view = await renderBoard(ENTRIES)
    const lane = view.getByRole('region', { name: 'to-read', exact: true }).element()

    await dragTo(await card(view, 'Dune'), lane)

    expect(commitProperties).not.toHaveBeenCalled()
  })

  it('creates a note born in the lane: tagged, with the lane value set', async () => {
    const onOpen = vi.fn()
    const view = await renderBoard(ENTRIES, onOpen)

    await view.getByRole('button', { name: 'New note in done' }).click()

    expect(createNoteIfAbsent).toHaveBeenCalledTimes(1)
    const [path, seed, generation] = createNoteIfAbsent.mock.calls[0] as unknown as [
      string,
      string,
      number,
    ]
    expect(path).toMatch(/^notes\/.+\.md$/)
    expect(generation).toBe(7)
    expect(seed).toContain('status: done')
    expect(seed).toContain('#book')
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith(path))
  })

  it('changes a card status through the select editor (the keyboard path)', async () => {
    const view = await renderBoard([ENTRIES[1]!])

    await view.getByRole('button', { name: 'Edit Status' }).click()
    await view.getByRole('option', { name: 'reading' }).click()
    expect(commitProperties).toHaveBeenCalledWith('notes/dune.md', { status: 'reading' })
  })
})
