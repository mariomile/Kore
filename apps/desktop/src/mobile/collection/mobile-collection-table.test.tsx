import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@kore/core'
import { MobileCollectionTable } from './mobile-collection-table'

const commitProperty = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
}))
vi.mock('@/lib/tags/use-open-relation', () => ({ useOpenRelation: () => () => {} }))
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
const DUE: TagProperty = { name: 'Due', key: 'due', type: 'date' }
const PROJECT: TagType = { properties: [STATUS, DUE] }

function text(value: string): CollectionValue {
  return { value, valueType: 'string', valueNumber: null }
}

function entry(path: string, title: string, properties: Record<string, CollectionValue>) {
  return { path, title, mtime: 0, isPinned: false, properties } as CollectionEntry
}

const ENTRIES = [
  entry('notes/kitchen.md', 'Kitchen shelves', { status: text('Idea') }),
  entry('notes/launch.md', 'V2 launch plan', { status: text('Doing'), due: text('2027-01-13') }),
]

async function mount() {
  const onOpen = vi.fn()
  const onCreate = vi.fn(async () => {})
  const view = await render(
    <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
      <MobileCollectionTable
        entries={ENTRIES}
        type={PROJECT}
        label="Project"
        onOpen={onOpen}
        onCreate={onCreate}
      />
    </div>,
  )
  return { view, onOpen, onCreate }
}

beforeEach(() => {
  commitProperty.mockReset()
})

describe('MobileCollectionTable', () => {
  it('shows the fields as columns and numbers the rows', async () => {
    const { view } = await mount()
    const table = view.getByRole('table', { name: 'Project' })
    await expect.element(table.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect.element(table.getByRole('columnheader', { name: 'Due' })).toBeInTheDocument()
    await expect.element(table.getByRole('rowheader', { name: 'Kitchen shelves' })).toBeVisible()
    await expect.element(table.getByRole('cell', { name: '2', exact: true })).toBeVisible()
  })

  it('opens the note from its title', async () => {
    const { view, onOpen } = await mount()
    await userEvent.click(view.getByRole('button', { name: 'V2 launch plan' }))
    expect(onOpen).toHaveBeenCalledWith('notes/launch.md')
  })

  it('edits a cell through the shared property editor', async () => {
    const { view } = await mount()
    await userEvent.click(view.getByRole('button', { name: 'Edit Status' }).first())
    await userEvent.click(view.getByRole('option', { name: 'Done' }))
    expect(commitProperty).toHaveBeenCalledWith('notes/kitchen.md', 'status', 'Done')
  })

  it('creates a note from the New row', async () => {
    const { view, onCreate } = await mount()
    await userEvent.click(view.getByRole('button', { name: 'New' }))
    await userEvent.type(view.getByRole('textbox', { name: 'New note title' }), 'Garden{Enter}')
    expect(onCreate).toHaveBeenCalledWith('Garden')
  })
})
