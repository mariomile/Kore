import { describe, expect, it } from 'vitest'
import { groupTasks, type TaskGroup } from '@reflect/core'
import { makeOpenTask as task } from './open-task-fixture'
import { taskKey } from './task-identity'
import { flattenTaskGroups, taskListItemKey } from './task-list-items'

const TODAY = '2026-06-14'

describe('flattenTaskGroups', () => {
  it('flattens a date bucket into a header followed by its tasks, no breadcrumb row', () => {
    const groups = groupTasks([task({ text: 'today', dueDate: TODAY, markerOffset: 0 })], TODAY)
    const items = flattenTaskGroups(groups)
    expect(items.map((item) => item.kind)).toEqual(['header', 'task'])
    expect(items[0]).toMatchObject({ kind: 'header', group: { kind: 'current' } })
    expect(items[1]).toMatchObject({ kind: 'task', showSource: true })
  })

  it('marks note-group task rows as not needing the source column', () => {
    const groups = groupTasks(
      [task({ text: 'undated', notePath: 'notes/p.md', noteTitle: 'P', markerOffset: 0 })],
      TODAY,
    )
    const items = flattenTaskGroups(groups)
    expect(items.map((item) => item.kind)).toEqual(['header', 'task'])
    expect(items[1]).toMatchObject({ kind: 'task', showSource: false })
  })

  it('inserts one breadcrumb row per consecutive run sharing outline context', () => {
    const groups = groupTasks(
      [
        task({
          text: 'a',
          notePath: 'notes/p.md',
          noteTitle: 'P',
          markerOffset: 0,
          breadcrumbs: ['Work'],
        }),
        task({
          text: 'b',
          notePath: 'notes/p.md',
          noteTitle: 'P',
          markerOffset: 1,
          breadcrumbs: ['Work'],
        }),
        task({
          text: 'c',
          notePath: 'notes/p.md',
          noteTitle: 'P',
          markerOffset: 2,
          breadcrumbs: ['Home'],
        }),
      ],
      TODAY,
    )
    const items = flattenTaskGroups(groups)
    expect(items.map((item) => item.kind)).toEqual([
      'header',
      'breadcrumb',
      'task',
      'task',
      'breadcrumb',
      'task',
    ])
  })

  it('omits the breadcrumb row when the context has no visible label (V1: hides a lone generic parent)', () => {
    const groups = groupTasks(
      [
        task({
          text: 'a',
          notePath: 'notes/p.md',
          noteTitle: 'P',
          markerOffset: 0,
          breadcrumbs: ['Tasks'],
        }),
      ],
      TODAY,
    )
    const items = flattenTaskGroups(groups)
    expect(items.map((item) => item.kind)).toEqual(['header', 'task'])
  })

  it('renders an "empty" row for a group with no tasks (defensive — groupTasks never produces one)', () => {
    const emptyGroup: TaskGroup = { kind: 'note', label: 'P', notePath: 'notes/p.md', tasks: [] }
    const items = flattenTaskGroups([emptyGroup])
    expect(items.map((item) => item.kind)).toEqual(['header', 'empty'])
  })

  it('preserves the exact task order groups.flatMap((g) => g.tasks) produces', () => {
    const groups = groupTasks(
      [
        task({ text: 'today', dueDate: TODAY, markerOffset: 0 }),
        task({ text: 'late', dueDate: '2026-06-01', markerOffset: 10 }),
        task({ text: 'project', notePath: 'notes/p.md', noteTitle: 'P', markerOffset: 20 }),
      ],
      TODAY,
    )
    const flatTasks = groups.flatMap((group) => group.tasks)
    const rowTasks = flattenTaskGroups(groups)
      .filter((item) => item.kind === 'task')
      .map((item) => item.task)
    expect(rowTasks.map(taskKey)).toEqual(flatTasks.map(taskKey))
  })

  it('flattens multiple groups back to back, each with its own header', () => {
    const groups = groupTasks(
      [
        task({ text: 'today', dueDate: TODAY, markerOffset: 0 }),
        task({ text: 'project', notePath: 'notes/p.md', noteTitle: 'P', markerOffset: 20 }),
      ],
      TODAY,
    )
    const items = flattenTaskGroups(groups)
    expect(items.map((item) => item.kind)).toEqual(['header', 'task', 'header', 'task'])
  })
})

describe('taskListItemKey', () => {
  it('gives every row in a mixed list a distinct key', () => {
    const groups = groupTasks(
      [
        task({ text: 'today', dueDate: TODAY, markerOffset: 0 }),
        task({
          text: 'a',
          notePath: 'notes/p.md',
          noteTitle: 'P',
          markerOffset: 1,
          breadcrumbs: ['Work'],
        }),
        task({ text: 'b', notePath: 'notes/p.md', noteTitle: 'P', markerOffset: 2 }),
      ],
      TODAY,
    )
    const items = flattenTaskGroups(groups)
    const keys = items.map(taskListItemKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keys a task row by its task identity, stable across re-flattening', () => {
    const groups = groupTasks([task({ text: 'today', dueDate: TODAY, markerOffset: 0 })], TODAY)
    const first = flattenTaskGroups(groups)
    const second = flattenTaskGroups(groups)
    expect(first.map(taskListItemKey)).toEqual(second.map(taskListItemKey))
  })
})
