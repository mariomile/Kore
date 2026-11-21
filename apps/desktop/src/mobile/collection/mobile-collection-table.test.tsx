import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@kore/core'
import { MobileCollectionTable } from './mobile-collection-table'

const commitProperty = vi.hoisted(() => vi.fn())
vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: () => {} }))
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
  useCommitNoteProperties: () => () => {},
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

async function mount(groupProperty: TagProperty | null = null) {
  const onOpen = vi.fn()
  const onCreate = vi.fn(async () => {})
  const view = await render(
    <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
      <MobileCollectionTable
        entries={ENTRIES}
        type={PROJECT}
        groupProperty={groupProperty}
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

  it('groups the rows under their status, numbering each group from 1', async () => {
    const { view } = await mount(STATUS)
    const table = view.getByRole('table', { name: 'Project' })
    await expect.element(table.getByRole('rowheader', { name: /^Idea\s*1$/ })).toBeVisible()
    await expect.element(table.getByRole('rowheader', { name: /^Doing\s*1$/ })).toBeVisible()
    // Done holds no rows, so the table shows no empty shelf for it.
    expect(table.getByRole('rowheader', { name: /^Done/ }).elements()).toHaveLength(0)
    expect(table.getByRole('cell', { name: '2', exact: true }).elements()).toHaveLength(0)
  })

  it('drops the New row when it has nowhere to create (an embedded preview)', async () => {
    const view = await render(
      <MobileCollectionTable
        embedded
        entries={ENTRIES}
        type={PROJECT}
        label="Project"
        onOpen={() => {}}
      />,
    )
    await expect.element(view.getByRole('rowheader', { name: 'Kitchen shelves' })).toBeVisible()
    expect(view.getByRole('button', { name: 'New', exact: true }).query()).toBeNull()
  })

  it('cycles column sort when tapping a column header', async () => {
    const onSortChange = vi.fn()
    const view = await render(
      <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable
          entries={ENTRIES}
          type={PROJECT}
          sorts={[]}
          onSortChange={onSortChange}
          label="Project"
          onOpen={() => {}}
        />
      </div>,
    )
    await userEvent.click(view.getByRole('button', { name: 'Status' }))
    expect(onSortChange).toHaveBeenCalledWith([{ key: 'status', direction: 'asc' }])
  })

  it('toggles a checkbox cell in place without opening the drawer', async () => {
    const DONE: TagProperty = { name: 'Done', key: 'done', type: 'checkbox' }
    const view = await render(
      <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable
          entries={[
            entry('notes/kitchen.md', 'Kitchen shelves', {
              done: { value: 'false', valueType: 'boolean', valueNumber: null },
            }),
          ]}
          type={{ properties: [DONE] }}
          label="Project"
          onOpen={() => {}}
        />
      </div>,
    )
    await userEvent.click(view.getByRole('checkbox', { name: 'Done' }))
    expect(commitProperty).toHaveBeenCalledWith('notes/kitchen.md', 'done', true)
  })

  it('commits an edited text draft when tapping Done in the drawer header', async () => {
    const OWNER: TagProperty = { name: 'Owner', key: 'owner', type: 'text' }
    const view = await render(
      <div style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable
          entries={[entry('notes/kitchen.md', 'Kitchen shelves', { owner: text('Ada') })]}
          type={{ properties: [OWNER] }}
          label="Project"
          onOpen={() => {}}
        />
      </div>,
    )
    await userEvent.click(view.getByRole('button', { name: 'Edit Owner' }))
    await view.getByRole('textbox', { name: 'Owner' }).fill('Grace')
    await userEvent.click(view.getByRole('button', { name: 'Done' }))
    expect(commitProperty).toHaveBeenCalledWith('notes/kitchen.md', 'owner', 'Grace')
  })

  it('prevents dragging right past the left edge while allowing leftward scroll', async () => {
    const view = await render(
      <div style={{ width: 300, height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable entries={ENTRIES} type={PROJECT} label="Project" onOpen={() => {}} />
      </div>,
    )
    const scroller = view.container.querySelector('.mobile-collection-table') as HTMLElement
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)

    const dispatchTouch = (
      type: 'touchstart' | 'touchmove' | 'touchend',
      x?: number,
      y?: number,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: type === 'touchmove' })
      Object.defineProperty(event, 'touches', {
        value: x !== undefined && y !== undefined ? [{ clientX: x, clientY: y }] : [],
      })
      scroller.dispatchEvent(event)
      return event
    }

    // Sub-threshold horizontal jitter must not cancel vertical scroll.
    dispatchTouch('touchstart', 120, 200)
    const jitter = dispatchTouch('touchmove', 122, 200)
    expect(jitter.defaultPrevented).toBe(false)
    const verticalAfterJitter = dispatchTouch('touchmove', 122, 212)
    expect(verticalAfterJitter.defaultPrevented).toBe(false)
    dispatchTouch('touchend')

    // Dragging right at scrollLeft = 0 past the axis threshold must be canceled.
    dispatchTouch('touchstart', 120, 200)
    const pullRight = dispatchTouch('touchmove', 140, 200)
    expect(pullRight.defaultPrevented).toBe(true)
    dispatchTouch('touchend')

    // Dragging left when more columns sit to the right stays allowed.
    dispatchTouch('touchstart', 140, 200)
    const pullLeft = dispatchTouch('touchmove', 110, 200)
    expect(pullLeft.defaultPrevented).toBe(false)
  })
})
