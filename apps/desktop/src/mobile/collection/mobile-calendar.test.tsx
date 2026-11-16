import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@kore/core'
import { MobileCalendar } from './mobile-calendar'

const createNote = vi.hoisted(() => vi.fn(async () => 'notes/new.md'))
vi.mock('@/lib/tags/use-create-collection-note', () => ({
  useCreateCollectionNote: () => createNote,
}))
vi.mock('@/mobile/haptics', () => ({ hapticImpactLight: () => {} }))
vi.mock('@/lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  todayIso: () => '2027-01-13',
}))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: {
      uiDensity: 'default',
      dateFormat: 'mdy',
      timeFormat: '12h',
      weekStartDay: 'monday',
    },
  }),
}))

const DUE: TagProperty = { name: 'Due', key: 'due', type: 'date' }
const PROJECT: TagType = { properties: [DUE] }

function text(value: string): CollectionValue {
  return { value, valueType: 'string', valueNumber: null }
}

function entry(path: string, title: string, due?: string): CollectionEntry {
  return {
    path,
    title,
    mtime: 0,
    isPinned: false,
    properties: due === undefined ? {} : { due: text(due) },
  } as CollectionEntry
}

const ENTRIES = [
  entry('notes/launch.md', 'V2 launch plan', '2027-01-13'),
  entry('notes/review.md', 'Design review', '2027-01-20'),
  entry('notes/someday.md', 'Someday'),
]

async function mount() {
  const onOpen = vi.fn()
  const view = await render(
    <div style={{ height: 800, display: 'flex', flexDirection: 'column' }}>
      <MobileCalendar
        entries={ENTRIES}
        property={DUE}
        tag="project"
        type={PROJECT}
        cardType={PROJECT}
        onOpen={onOpen}
      />
    </div>,
  )
  return { view, onOpen }
}

describe('MobileCalendar', () => {
  it('lists today’s notes and counts the undated ones', async () => {
    const { view } = await mount()
    await expect.element(view.getByRole('grid', { name: 'January 2027' })).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'V2 launch plan' })).toBeVisible()
    await expect.element(view.getByText(/1 note has no Due/)).toBeVisible()
  })

  it('shows another day’s notes when it is tapped, and opens one', async () => {
    const { view, onOpen } = await mount()
    await userEvent.click(view.getByRole('gridcell', { name: /January 20, 1 note/ }))
    await userEvent.click(view.getByRole('button', { name: 'Design review' }))
    expect(onOpen).toHaveBeenCalledWith('notes/review.md')
  })

  it('creates a note dated on the picked day and opens it', async () => {
    const { view, onOpen } = await mount()
    await userEvent.click(view.getByRole('gridcell', { name: /January 15/ }))
    await userEvent.click(view.getByRole('button', { name: /^New on/ }))
    expect(createNote).toHaveBeenCalledWith({ due: '2027-01-15' })
    expect(onOpen).toHaveBeenCalledWith('notes/new.md')
  })
})
