import { describe, expect, it } from 'vitest'
import type { OpenColumn } from '@reflect/core'
import {
  addTabTo,
  emptyPane,
  insertColumn,
  insertPane,
  layoutIdsKey,
  locate,
  removePane,
  removeTabFrom,
} from './pane-layout'

const NOTE_A = { kind: 'note', path: 'notes/a.md', pinned: false } as const
const NOTE_B = { kind: 'note', path: 'notes/b.md', pinned: false } as const

function layout(): OpenColumn[] {
  return [
    { id: 'main', panes: [emptyPane('main'), emptyPane('under')] },
    { id: 'column-2', panes: [emptyPane('right')] },
  ]
}

describe('pane layout', () => {
  it('locates a pane by column and row', () => {
    expect(locate(layout(), 'under')).toEqual({ column: 0, row: 1 })
    expect(locate(layout(), 'right')).toEqual({ column: 1, row: 0 })
    expect(locate(layout(), 'missing')).toBeNull()
  })

  it('inserts a pane at a row, appending when the row is past the end', () => {
    const inserted = insertPane(layout(), emptyPane('new'), { column: 0, row: 1 })
    expect(inserted[0]!.panes.map((pane) => pane.id)).toEqual(['main', 'new', 'under'])
    const appended = insertPane(layout(), emptyPane('new'), { column: 1, row: 1 })
    expect(appended[1]!.panes.map((pane) => pane.id)).toEqual(['right', 'new'])
  })

  it('inserts a column at an index', () => {
    const inserted = insertColumn(layout(), { id: 'column-3', panes: [emptyPane('new')] }, 1)
    expect(inserted.map((column) => column.id)).toEqual(['main', 'column-3', 'column-2'])
  })

  it('removes a pane and drops the column it emptied', () => {
    const removed = removePane(layout(), 'right')
    expect(removed.map((column) => column.id)).toEqual(['main'])
    expect(removed[0]!.panes.map((pane) => pane.id)).toEqual(['main', 'under'])
  })

  it('keeps a column that still holds panes', () => {
    const removed = removePane(layout(), 'under')
    expect(removed.map((column) => column.id)).toEqual(['main', 'column-2'])
    expect(removed[0]!.panes.map((pane) => pane.id)).toEqual(['main'])
  })

  it('adds a tab to a pane and makes it active', () => {
    const added = addTabTo(layout(), 'right', NOTE_A)
    expect(added[1]!.panes[0]).toEqual({
      id: 'right',
      tabs: [NOTE_A],
      activeKey: 'note:notes/a.md',
    })
  })

  it('does not add the same tab twice, but still activates it', () => {
    const once = addTabTo(layout(), 'right', NOTE_A)
    const twice = addTabTo(addTabTo(once, 'right', NOTE_B), 'right', NOTE_A)
    expect(twice[1]!.panes[0]!.tabs).toEqual([NOTE_A, NOTE_B])
    expect(twice[1]!.panes[0]!.activeKey).toBe('note:notes/a.md')
  })

  it('removes a tab and hands the active key to its neighbour', () => {
    const seeded = addTabTo(addTabTo(layout(), 'main', NOTE_A), 'main', NOTE_B)
    const withoutB = removeTabFrom(seeded, 'main', NOTE_B)
    expect(withoutB[0]!.panes[0]).toEqual({
      id: 'main',
      tabs: [NOTE_A],
      activeKey: 'note:notes/a.md',
    })
    const empty = removeTabFrom(withoutB, 'main', NOTE_A)
    expect(empty[0]!.panes[0]).toEqual({ id: 'main', tabs: [], activeKey: null })
  })

  it('restores a stacked layout, dropping the panes with nothing to reopen', () => {
    // A cold restart: no handle is live yet, so only the first pane of the
    // first column (it launches the window) and the panes with a tab to
    // reopen survive. The second column has neither, and goes with them.
    const stored: OpenColumn[] = [
      {
        id: 'main',
        panes: [
          { id: 'main', tabs: [], activeKey: null },
          { id: 'under', tabs: [NOTE_B], activeKey: 'note:notes/b.md' },
        ],
      },
      {
        id: 'column-2',
        panes: [
          { id: 'right', tabs: [], activeKey: null },
          { id: 'right-below', tabs: [NOTE_A], activeKey: null },
        ],
      },
    ]
    expect(layoutIdsKey(stored, () => false)).toBe('main:main,under')
  })

  it('keeps a dropped pane whose handle is already live', () => {
    const stored: OpenColumn[] = [
      { id: 'main', panes: [{ id: 'main', tabs: [], activeKey: null }] },
      { id: 'column-2', panes: [{ id: 'right', tabs: [], activeKey: null }] },
    ]
    expect(layoutIdsKey(stored, (id) => id === 'right')).toBe('main:main|column-2:right')
  })

  it('leaves the active key alone when another tab was showing', () => {
    const seeded = addTabTo(addTabTo(layout(), 'main', NOTE_B), 'main', NOTE_A)
    const removed = removeTabFrom(seeded, 'main', NOTE_B)
    expect(removed[0]!.panes[0]!.activeKey).toBe('note:notes/a.md')
  })
})
