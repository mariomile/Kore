import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@kore/core'
import { boardColumns } from '@/components/all-notes/collection-board'
import { laneMove } from './board-move'
import { MobileBoard } from './mobile-board'

const commitProperties = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperties: () => commitProperties,
}))
const createNote = vi.hoisted(() => vi.fn(async () => 'notes/new.md'))
vi.mock('@/lib/tags/use-create-collection-note', () => ({
  useCreateCollectionNote: () => createNote,
}))
vi.mock('@/hooks/use-open-task-counts', () => ({ useOpenTaskCounts: () => ({}) }))
vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { uiDensity: 'default', dateFormat: 'mdy', timeFormat: '12h' },
  }),
}))

const STATUS: TagProperty = {
  name: 'Status',
  key: 'status',
  type: 'select',
  options: ['Idea', 'Doing', 'Done'],
}
const AREA: TagProperty = { name: 'Area', key: 'area', type: 'select', options: ['Work', 'Home'] }
const LABELS: TagProperty = {
  name: 'Labels',
  key: 'labels',
  type: 'multiselect',
  options: ['red', 'blue'],
}
const PROJECT: TagType = { properties: [STATUS, AREA] }

function text(value: string): CollectionValue {
  return { value, valueType: 'string', valueNumber: null }
}

function entry(path: string, title: string, properties: Record<string, CollectionValue>) {
  return { path, title, properties } as CollectionEntry
}

const ENTRIES = [
  entry('notes/kitchen.md', 'Kitchen shelves', { status: text('Idea'), area: text('Home') }),
  entry('notes/launch.md', 'V2 launch plan', { status: text('Doing'), area: text('Work') }),
  entry('notes/taxes.md', 'File taxes', { status: text('Done') }),
]

async function mount(overrides: Partial<Parameters<typeof MobileBoard>[0]> = {}) {
  const onOpen = vi.fn()
  const onGroupChange = vi.fn()
  return {
    onOpen,
    onGroupChange,
    view: await render(
      <MobileBoard
        entries={ENTRIES}
        tag="project"
        type={PROJECT}
        property={STATUS}
        groupProperties={[STATUS, AREA]}
        onGroupChange={onGroupChange}
        onOpen={onOpen}
        {...overrides}
      />,
    ),
  }
}

describe('MobileBoard', () => {
  beforeEach(() => {
    commitProperties.mockClear()
    createNote.mockClear()
  })

  it('renders every lane side by side in a horizontally scrollable strip', async () => {
    const { view } = await mount()
    const strip = view.getByLabelText('Status lanes').element()
    expect(strip.className).toContain('overflow-x-auto')
    expect(strip.className).toContain('snap-x')

    const ideaLane = view.getByRole('region', { name: 'Idea' })
    const doingLane = view.getByRole('region', { name: 'Doing' })
    const doneLane = view.getByRole('region', { name: 'Done' })
    await expect
      .element(ideaLane.getByRole('button', { name: 'Kitchen shelves', exact: true }))
      .toBeVisible()
    await expect
      .element(doingLane.getByRole('button', { name: 'V2 launch plan', exact: true }))
      .toBeInTheDocument()
    await expect
      .element(doneLane.getByRole('button', { name: 'File taxes', exact: true }))
      .toBeInTheDocument()
  })

  it('moves a card to another lane with one tap and writes the value', async () => {
    const { view } = await mount()
    await view.getByRole('button', { name: 'Move Kitchen shelves' }).click()
    await view.getByRole('button', { name: /^Done/ }).last().click()

    expect(commitProperties).toHaveBeenCalledWith('notes/kitchen.md', { status: 'Done' })
    // The overlay moves it at once: the Idea lane is empty and Done holds it.
    await expect.element(view.getByText('Nothing in Idea')).toBeVisible()
    await expect
      .element(
        view
          .getByRole('region', { name: 'Done' })
          .getByRole('button', { name: 'Kitchen shelves', exact: true }),
      )
      .toBeInTheDocument()
  })

  it('opens a card and creates a note born in the chosen lane', async () => {
    const { view, onOpen } = await mount()
    await view.getByRole('button', { name: 'Kitchen shelves', exact: true }).click()
    expect(onOpen).toHaveBeenCalledWith('notes/kitchen.md')

    await view.getByRole('button', { name: 'New in Doing' }).click()
    await expect.poll(() => createNote.mock.calls.at(-1)).toEqual([{ status: 'Doing' }])
    await expect.poll(() => onOpen.mock.calls.at(-1)).toEqual(['notes/new.md'])
  })

  it('changes the grouping from the group pill', async () => {
    const { view, onGroupChange } = await mount()
    await view
      .getByRole('button', { name: /^Status/ })
      .first()
      .click()
    await view.getByRole('button', { name: 'Area', exact: true }).click()
    expect(onGroupChange).toHaveBeenCalledWith('area')
  })
})

describe('laneMove', () => {
  it('writes the target value for a single-valued property', () => {
    const columns = boardColumns(ENTRIES, STATUS)
    const [idea, doing] = columns
    expect(laneMove(STATUS, ENTRIES[0]!, idea!, doing!)).toEqual({ value: 'Doing' })
    expect(laneMove(STATUS, ENTRIES[0]!, idea!, idea!)).toBe('unchanged')
    const unset = columns.at(-1)!
    expect(laneMove(STATUS, ENTRIES[0]!, idea!, unset)).toEqual({ value: null })
  })

  it('swaps only the source option on a multi-select card', () => {
    const tagged = entry('notes/a.md', 'A', {
      labels: { value: '["red","blue"]', valueType: 'list', valueNumber: 2 },
    })
    const columns = boardColumns([tagged], LABELS)
    const red = columns.find((column) => column.label === 'red')!
    const blue = columns.find((column) => column.label === 'blue')!
    const unset = columns.at(-1)!
    expect(laneMove(LABELS, tagged, red, blue)).toEqual({ value: ['blue'] })
    expect(laneMove(LABELS, tagged, red, unset)).toEqual({ value: ['blue'] })
  })
})
