import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, CollectionValue, TagType } from '@reflect/core'
import {
  calendarProperty,
  CollectionCalendar,
  entriesByDate,
  monthGrid,
} from './collection-calendar'

vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { weekStartDay: 'monday', dateFormat: 'mdy', timeFormat: '12h' },
    updateSettings: vi.fn(),
  }),
}))

const BOOK_TYPE: TagType = {
  properties: [
    { name: 'Author', key: 'author', type: 'text' },
    { name: 'Finished', key: 'finished', type: 'date' },
  ],
}
const FINISHED = calendarProperty(BOOK_TYPE)!

function stored(value: string): CollectionValue {
  return { value, valueType: 'string', valueNumber: null }
}

function entry(path: string, title: string, finished?: string): CollectionEntry {
  return {
    path,
    title,
    mtime: 1,
    isPinned: false,
    properties: finished === undefined ? {} : { finished: stored(finished) },
  }
}

describe('calendarProperty', () => {
  it('picks the first date property, or null without one', () => {
    expect(FINISHED.key).toBe('finished')
    expect(calendarProperty({ properties: [BOOK_TYPE.properties[0]!] })).toBeNull()
  })
})

describe('entriesByDate', () => {
  it('groups by calendar-date values and skips everything else', () => {
    const grouped = entriesByDate(
      [
        entry('a', 'A', '2026-08-10'),
        entry('b', 'B', '2026-08-10'),
        entry('c', 'C', 'not a date'),
        entry('d', 'D'),
      ],
      FINISHED,
    )
    expect(grouped.get('2026-08-10')?.map((row) => row.path)).toEqual(['a', 'b'])
    expect(grouped.size).toBe(1)
  })
})

describe('monthGrid', () => {
  it('aligns six full weeks to the week start', () => {
    // August 2026 starts on a Saturday; with a Monday week start the grid
    // leads with Mon Jul 27 and always spans 42 cells.
    const cells = monthGrid(2026, 7, 1)
    expect(cells).toHaveLength(42)
    expect(cells[0]).toEqual({ iso: '2026-07-27', day: 27, inMonth: false })
    expect(cells[5]).toEqual({ iso: '2026-08-01', day: 1, inMonth: true })
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31)
  })
})

describe('CollectionCalendar', () => {
  it('places notes on their day and opens one on click', async () => {
    const onOpen = vi.fn()
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`
    const view = await render(
      <div style={{ height: '100vh' }}>
        <CollectionCalendar
          entries={[entry('notes/a.md', 'The Dispossessed', iso)]}
          property={FINISHED}
          onOpen={onOpen}
        />
      </div>,
    )

    await view.getByRole('button', { name: 'The Dispossessed' }).click()
    expect(onOpen).toHaveBeenCalledWith('notes/a.md', expect.anything())
    await expect.element(view.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('pages to a month with no placed notes and back', async () => {
    const view = await render(
      <div style={{ height: '100vh' }}>
        <CollectionCalendar
          entries={[entry('notes/a.md', 'The Dispossessed', '2026-08-10')]}
          property={FINISHED}
          onOpen={() => {}}
        />
      </div>,
    )

    await view.getByRole('button', { name: 'Next month' }).click()
    await view.getByRole('button', { name: 'Previous month' }).click()
    await view.getByRole('button', { name: 'Today' }).click()
    await expect.element(view.getByRole('button', { name: 'Next month' })).toBeInTheDocument()
  })
})
