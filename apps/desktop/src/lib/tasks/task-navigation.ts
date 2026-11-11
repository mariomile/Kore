import { dailyPath, taskDateBucket, type OpenTask, type TaskView } from '@kore/core'
import type { InsertTaskTarget } from '@/lib/tasks/task-insert-target'
import { sameTask, taskKey } from '@/lib/tasks/task-identity'

/**
 * Shared Tasks-view navigation helpers (Plan 18, V1 parity). The keyboard
 * handler and the inline editor both move the selection between rows, add tasks,
 * and keep the active row on screen, so the small bits of logic they have in
 * common live here — one definition, no drift between the editing and
 * not-editing paths.
 */

/** The note context a new task inherits when added next to `task` (V1: same note/group). */
export function insertTargetForTask(task: OpenTask): InsertTaskTarget {
  return {
    notePath: task.notePath,
    noteTitle: task.noteTitle,
    dailyDate: task.dailyDate,
    isPinned: task.isPinned,
    pinnedOrder: task.pinnedOrder,
  }
}

/** A day's daily note as an insert target (an Upcoming day's "+ Add"). */
export function dailyTarget(date: string): InsertTaskTarget {
  return {
    notePath: dailyPath(date),
    noteTitle: date,
    dailyDate: date,
    isPinned: false,
    pinnedOrder: null,
  }
}

/** Today's daily note as an insert target — V1's "add to Today" / Current bucket. */
export function todaysDailyTarget(today: string): InsertTaskTarget {
  return dailyTarget(today)
}

/**
 * Where a task added next to `task` lands, by V1's **group-based** rule
 * (`insertIntoGroup`): a Current task adds to today's daily, an undated (note)
 * task adds to its own note, and Overdue/Upcoming refuse — those buckets
 * aggregate tasks across many notes, so "add here" has no single home (`null`).
 */
export function insertTargetForBucket(
  task: OpenTask,
  today: string,
  view: TaskView = 'all',
): InsertTaskTarget | null {
  if (view === 'inbox' || view === 'projects') {
    // These views list tasks where they live: a neighbour joins the same note,
    // so it stays in the view beside the task it was added after.
    return insertTargetForTask(task)
  }
  switch (taskDateBucket(task, today)) {
    case 'current':
      return todaysDailyTarget(today)
    case 'note':
      return insertTargetForTask(task)
    default:
      return null // overdue / upcoming — no single note to add into
  }
}

/**
 * The key to select after deleting `task` (V1's `selectPreviousTask`): the row
 * just above it, or — when it was the first — the row just below (which becomes
 * the new first). `null` when it was the only row, so the caller clears.
 */
export function previousTaskKey(ordered: readonly OpenTask[], task: OpenTask): string | null {
  const index = ordered.findIndex((row) => sameTask(row, task))
  if (index === -1) {
    return null
  }
  const previous = ordered[index === 0 ? 1 : index - 1]
  return previous ? taskKey(previous) : null
}
