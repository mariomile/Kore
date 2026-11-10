import {
  groupTaskContexts,
  subtaskDepths,
  type OpenTask,
  type TaskContext,
  type TaskGroup,
} from '@reflect/core'
import { taskKey } from './task-identity'

/**
 * One row of the virtualized Tasks list (virtualizing the last unvirtualized
 * list surface): every group's header, breadcrumb, and task row flattened into
 * a single top-to-bottom order, so {@link import('@/components/tasks/task-list').TaskList}
 * can hand `virtua`'s `Virtualizer` one uniform list instead of nesting a
 * scroll region per group (which would fight the shared scroll container and
 * defeat virtualization — an off-screen group's rows would still all mount).
 */
export type TaskListItem =
  | { kind: 'header'; group: TaskGroup }
  | { kind: 'empty'; group: TaskGroup }
  | { kind: 'section'; group: TaskGroup; label: string; firstTask: OpenTask }
  | { kind: 'breadcrumb'; group: TaskGroup; context: TaskContext }
  | {
      kind: 'task'
      group: TaskGroup
      task: OpenTask
      showSource: boolean
      /** How many levels this row nests under a parent task shown above it. */
      depth: number
    }

/** A group's stable identity — a date bucket's kind, an Upcoming day's date, or a note group's path. */
function groupIdentity(group: TaskGroup): string {
  if (group.kind === 'note') {
    return `note:${group.notePath}`
  }
  return group.date === undefined ? group.kind : `${group.kind}:${group.date}`
}

/** The React/virtua key for one flattened row — unique across the whole list. */
export function taskListItemKey(item: TaskListItem): string {
  switch (item.kind) {
    case 'header':
      return `header:${groupIdentity(item.group)}`
    case 'empty':
      return `empty:${groupIdentity(item.group)}`
    case 'section':
      return `section:${groupIdentity(item.group)}:${taskKey(item.firstTask)}`
    case 'breadcrumb':
      // A context's first task pins the row to one run of consecutive tasks —
      // two contexts sharing breadcrumbs within the same group never collide.
      return `breadcrumb:${taskKey(item.context.tasks[0]!)}`
    case 'task':
      return `task:${taskKey(item.task)}`
  }
}

/**
 * Flatten task groups into one ordered row list: each group contributes a
 * header, then either an "empty" placeholder or its contexts — a breadcrumb
 * row (only when the context has a visible label, matching
 * {@link import('@/components/tasks/task-breadcrumbs').TaskBreadcrumbs}'s own
 * empty-breadcrumbs no-op) followed by its task rows. Task order within a
 * group is preserved exactly, so this stays in lockstep with
 * `groups.flatMap((group) => group.tasks)` — the order the selection's own
 * row math (`useListSelection`) already depends on.
 */
export function flattenTaskGroups(groups: readonly TaskGroup[]): TaskListItem[] {
  const items: TaskListItem[] = []
  for (const group of groups) {
    items.push({ kind: 'header', group })
    if (group.tasks.length === 0) {
      items.push({ kind: 'empty', group })
      continue
    }
    // Date buckets aggregate tasks from many notes, so their rows show the
    // source; a note group's rows already sit under that note's own header.
    const showSource = group.kind !== 'note'
    // A project's headings become section rows; subtasks indent under a parent
    // task listed above them instead of repeating it as a breadcrumb.
    const depths = new Map(
      subtaskDepths(group.tasks).map((depth, index) => [taskKey(group.tasks[index]!), depth]),
    )
    const sections = group.sections ?? [{ label: null, tasks: group.tasks }]
    for (const section of sections) {
      if (section.label !== null && section.tasks.length > 0) {
        items.push({ kind: 'section', group, label: section.label, firstTask: section.tasks[0]! })
      }
      for (const context of groupTaskContexts(section.tasks)) {
        const underParent = (depths.get(taskKey(context.tasks[0]!)) ?? 0) > 0
        if (context.visibleBreadcrumbs.length > 0 && !underParent) {
          items.push({ kind: 'breadcrumb', group, context })
        }
        for (const task of context.tasks) {
          items.push({
            kind: 'task',
            group,
            task,
            showSource,
            depth: depths.get(taskKey(task)) ?? 0,
          })
        }
      }
    }
  }
  return items
}
