import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { CollectionEntry, TagType } from '@kore/core'
import { addDaysIso } from '@kore/utils'
import { todayIso } from '@/lib/dates'
import { timelineFieldsOf } from '@/lib/tags/timeline-layout'
import { CollectionTimeline } from './collection-timeline'

const commitProperties = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperties: () => commitProperties,
}))
vi.mock('@/lib/tags/use-create-collection-note', () => ({
  useCreateCollectionNote: () => async () => null,
}))
vi.mock('@/providers/settings-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/settings-provider')>()),
  useSettings: () => ({
    settings: { weekStartDay: 'monday', dateFormat: 'mdy', timeFormat: '12h' },
    updateSettings: vi.fn(),
  }),
}))

const PROJECT: TagType = {
  properties: [
    { name: 'Start', key: 'start', type: 'date' },
    { name: 'End', key: 'end', type: 'date' },
  ],
}
const FIELDS = timelineFieldsOf(PROJECT.properties)!

function entry(path: string, title: string, start?: string, end?: string): CollectionEntry {
  const value = (text: string) => ({ value: text, valueType: 'string' as const, valueNumber: null })
  return {
    path,
    title,
    mtime: 1,
    isPinned: false,
    properties: {
      ...(start === undefined ? {} : { start: value(start) }),
      ...(end === undefined ? {} : { end: value(end) }),
    },
  }
}

function pointer(target: Element, type: string, clientX: number): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY: 10 }),
  )
}

describe('CollectionTimeline', () => {
  const today = todayIso()
  const entries = [
    entry('notes/launch.md', 'Launch', today, addDaysIso(today, 9)),
    entry('notes/someday.md', 'Someday'),
  ]

  it('draws a bar per dated note, and dragging it writes both dates', async () => {
    commitProperties.mockClear()
    const onOpen = vi.fn()
    const screen = await render(
      <div style={{ height: 600, width: 1000 }}>
        <CollectionTimeline
          entries={entries}
          fields={FIELDS}
          groupProperty={null}
          zoom="week"
          onZoomChange={vi.fn()}
          tag="project"
          type={PROJECT}
          onOpen={onOpen}
        />
      </div>,
    )
    await expect.element(screen.getByText('1 note has no Start')).toBeVisible()
    const barLocator = screen.getByRole('button', { name: /^Launch, / })
    await expect.element(barLocator).toBeInTheDocument()
    const bar = barLocator.element()

    // A week day is 44px: two days to the right moves the whole bar.
    pointer(bar, 'pointerdown', 100)
    pointer(bar, 'pointermove', 190)
    pointer(bar, 'pointerup', 190)
    expect(commitProperties).toHaveBeenCalledWith('notes/launch.md', {
      start: addDaysIso(today, 2),
      end: addDaysIso(today, 11),
    })

    // A press without movement opens the note.
    pointer(bar, 'pointerdown', 100)
    pointer(bar, 'pointerup', 100)
    expect(onOpen).toHaveBeenCalledWith('notes/launch.md', expect.anything())
  })
})
