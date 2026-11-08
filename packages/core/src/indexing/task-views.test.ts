import { describe, expect, it } from 'vitest'
import type { OpenTask } from './queries'
import {
  countTasksByView,
  groupTasksForView,
  isFolderNotePath,
  projectForNote,
  taskViewsFor,
} from './task-views'

const TODAY = '2026-11-08'

function task(overrides: Partial<OpenTask> = {}): OpenTask {
  return {
    notePath: 'notes/n.md',
    markerOffset: 0,
    raw: '[ ] do it',
    checked: false,
    text: 'do it',
    breadcrumbs: [],
    noteTitle: 'N',
    dueDate: null,
    dueTime: null,
    dailyDate: null,
    isPinned: false,
    pinnedOrder: null,
    updatedAt: 0,
    ...overrides,
  }
}

const overdue = task({
  markerOffset: 1,
  dueDate: '2026-11-01',
  dailyDate: '2026-10-30',
  notePath: 'daily/2026-10-30.md',
})
const dueToday = task({
  markerOffset: 2,
  dueDate: TODAY,
  notePath: 'Projects/Kore/Plan.md',
  noteTitle: 'Plan',
})
const jottedToday = task({ markerOffset: 3, dailyDate: TODAY, notePath: `daily/${TODAY}.md` })
const staleCapture = task({
  markerOffset: 4,
  dailyDate: '2026-11-05',
  notePath: 'daily/2026-11-05.md',
})
const tomorrow = task({ markerOffset: 5, dueDate: '2026-11-09' })
const farOff = task({ markerOffset: 6, dueDate: '2026-12-25' })
const undated = task({ markerOffset: 7, notePath: 'Projects/Kore/Kore.md', noteTitle: 'Kore' })

const ALL = [overdue, dueToday, jottedToday, staleCapture, tomorrow, farOff, undated]

describe('taskViewsFor', () => {
  it('places every task in the Todoist views', () => {
    expect(taskViewsFor(overdue, TODAY)).toEqual(['today'])
    expect(taskViewsFor(dueToday, TODAY)).toEqual(['today', 'projects'])
    expect(taskViewsFor(jottedToday, TODAY)).toEqual(['today'])
    expect(taskViewsFor(staleCapture, TODAY)).toEqual(['inbox'])
    expect(taskViewsFor(tomorrow, TODAY)).toEqual(['upcoming', 'projects'])
    expect(taskViewsFor(undated, TODAY)).toEqual(['projects'])
  })
})

describe('groupTasksForView', () => {
  it('Today: overdue first, then today', () => {
    const groups = groupTasksForView('today', ALL, TODAY)
    expect(
      groups.map((group) => [group.kind, group.tasks.map((entry) => entry.markerOffset)]),
    ).toEqual([
      ['overdue', [1]],
      ['today', [2, 3]],
    ])
  })

  it('Upcoming: seven day columns, empty ones included, then Later', () => {
    const groups = groupTasksForView('upcoming', ALL, TODAY)
    expect(groups).toHaveLength(8)
    expect(groups[0]).toMatchObject({ kind: 'day', date: '2026-11-09' })
    expect(groups[0]!.tasks.map((entry) => entry.markerOffset)).toEqual([5])
    expect(groups[1]!.tasks).toEqual([])
    expect(groups[7]).toMatchObject({ kind: 'later' })
    expect(groups[7]!.tasks.map((entry) => entry.markerOffset)).toEqual([6])
  })

  it('Inbox: bare tasks left in past dailies', () => {
    const groups = groupTasksForView('inbox', ALL, TODAY)
    expect(groups.map((group) => group.tasks.map((entry) => entry.markerOffset))).toEqual([[4]])
  })

  it('Projects: notes under a folder note gather under it', () => {
    const groups = groupTasksForView('projects', ALL, TODAY, new Set(['Projects/Kore/Kore.md']))
    const kore = groups.find((group) => group.notePath === 'Projects/Kore/Kore.md')
    expect(kore?.label).toBe('Kore')
    expect(kore?.tasks.map((entry) => entry.markerOffset).sort()).toEqual([2, 7])
  })

  it('counts each view', () => {
    expect(countTasksByView(ALL, TODAY)).toEqual({
      today: 3,
      upcoming: 2,
      inbox: 1,
      projects: 4,
      all: 7,
    })
  })
})

describe('projects', () => {
  it('recognizes folder notes and falls back to the note itself', () => {
    expect(isFolderNotePath('Active/Projects/Kore/Kore.md')).toBe(true)
    expect(isFolderNotePath('notes/Kore.md')).toBe(false)
    const folders = new Set(['Active/Projects/Kore/Kore.md'])
    expect(projectForNote('Active/Projects/Kore/specs/Tasks.md', 'Tasks', folders)).toEqual({
      path: 'Active/Projects/Kore/Kore.md',
      title: 'Kore',
    })
    expect(projectForNote('notes/Loose.md', 'Loose', folders)).toEqual({
      path: 'notes/Loose.md',
      title: 'Loose',
    })
  })
})
