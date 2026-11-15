import { describe, expect, it } from 'vitest'
import type { CollectionEntry, TagProperty } from '@kore/core'
import {
  mobileColumnWidth,
  mobileTypeView,
  rowsMatchingTitle,
  storedTypeView,
} from './mobile-type-view'

function entry(title: string): CollectionEntry {
  return { path: `notes/${title}.md`, title, mtime: 0, isPinned: false, properties: {} }
}

describe('mobileTypeView', () => {
  it('opens the Mac’s board and grid as the phone’s board and gallery', () => {
    expect(mobileTypeView('board')).toBe('board')
    expect(mobileTypeView('grid')).toBe('gallery')
    expect(mobileTypeView('table')).toBe('table')
  })

  it('reads a calendar view as the table until the phone has one', () => {
    expect(mobileTypeView('calendar')).toBe('table')
  })

  it('writes the gallery back as the grid both devices share', () => {
    expect(storedTypeView('gallery')).toBe('grid')
    expect(storedTypeView('board')).toBe('board')
    expect(storedTypeView('table')).toBe('table')
  })
})

describe('rowsMatchingTitle', () => {
  const rows = [entry('Città di Roma'), entry('Atlas launch'), entry('Kitchen')]

  it('keeps every row for an empty search', () => {
    expect(rowsMatchingTitle(rows, '  ')).toBe(rows)
  })

  it('matches titles ignoring case and accents', () => {
    expect(rowsMatchingTitle(rows, 'citta').map((row) => row.title)).toEqual(['Città di Roma'])
    expect(rowsMatchingTitle(rows, 'LAUNCH').map((row) => row.title)).toEqual(['Atlas launch'])
  })
})

describe('mobileColumnWidth', () => {
  it('gives a checkbox a narrow column and text a wide one', () => {
    const checkbox: TagProperty = { name: 'Done', key: 'done', type: 'checkbox' }
    const text: TagProperty = { name: 'Notes', key: 'notes', type: 'text' }
    expect(mobileColumnWidth(checkbox)).toBeLessThan(mobileColumnWidth(text))
  })
})
