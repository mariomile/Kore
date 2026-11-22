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

  it('clamps horizontal column panning to [0, max] and never detaches the left pane', async () => {
    const view = await render(
      <div style={{ width: 300, height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable entries={ENTRIES} type={PROJECT} label="Project" onOpen={() => {}} />
      </div>,
    )
    const scroller = view.container.querySelector('.mobile-collection-table') as HTMLElement
    // The scroll container itself never overflows horizontally — frozen columns stay bolted to x=0.
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)

    const firePointer = (type: string, clientX: number, clientY: number): void => {
      scroller.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          clientX,
          clientY,
        }),
      )
    }

    // Dragging right at rest stays pinned at 0px (no negative overscroll).
    firePointer('pointerdown', 140, 200)
    firePointer('pointermove', 200, 200)
    firePointer('pointerup', 200, 200)
    expect(scroller.style.getPropertyValue('--table-scroll-x')).toBe('0px')
    expect(scroller.hasAttribute('data-scrolled-x')).toBe(false)

    // Dragging left pans property columns smoothly and sets the scrolled shadow flag.
    firePointer('pointerdown', 200, 200)
    firePointer('pointermove', 140, 200)
    firePointer('pointerup', 140, 200)
    expect(scroller.style.getPropertyValue('--table-scroll-x')).toBe('60px')
    expect(scroller.hasAttribute('data-scrolled-x')).toBe(true)

    // Dragging right past 0 clamps cleanly back to 0px (never negative).
    firePointer('pointerdown', 100, 200)
    firePointer('pointermove', 260, 200)
    firePointer('pointerup', 260, 200)
    expect(scroller.style.getPropertyValue('--table-scroll-x')).toBe('0px')
    expect(scroller.hasAttribute('data-scrolled-x')).toBe(false)
  })

  it('pans all columns by default and freezes up to the requested column count', async () => {
    const flat = await render(
      <div style={{ width: 390, height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable entries={ENTRIES} type={PROJECT} label="Project" onOpen={() => {}} />
      </div>,
    )
    const flatTitleHeader = flat.getByRole('columnheader', { name: 'Title' }).element()
    expect(flatTitleHeader.closest('.mobile-table-pan-track')).not.toBeNull()
    expect(flat.container.querySelector('.mobile-table-frozen-edge')).toBeNull()
    await flat.unmount()

    const frozen = await render(
      <div style={{ width: 390, height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable
          entries={ENTRIES}
          type={PROJECT}
          frozenColumns={2}
          label="Project"
          onOpen={() => {}}
        />
      </div>,
    )
    const statusHeader = frozen.getByRole('columnheader', { name: 'Status' }).element()
    const dueHeader = frozen.getByRole('columnheader', { name: 'Due' }).element()
    expect(statusHeader.closest('.mobile-table-pan-track')).toBeNull()
    expect(statusHeader.className).toContain('mobile-table-frozen-edge')
    expect(dueHeader.closest('.mobile-table-pan-track')).not.toBeNull()
    await frozen.unmount()

    // Freezing more columns than fit on a 390px phone steps down so remaining columns stay reachable.
    const NOTES: TagProperty = { name: 'Notes', key: 'notes', type: 'text' }
    const overflow = await render(
      <div style={{ width: 390, height: 600, display: 'flex', flexDirection: 'column' }}>
        <MobileCollectionTable
          entries={ENTRIES}
          type={{ properties: [STATUS, DUE, NOTES] }}
          frozenColumns={3}
          label="Project"
          onOpen={() => {}}
        />
      </div>,
    )
    await vi.waitFor(() => {
      const overflowDue = overflow.getByRole('columnheader', { name: 'Due' }).element()
      expect(overflowDue.closest('.mobile-table-pan-track')).not.toBeNull()
    })
  })
})
