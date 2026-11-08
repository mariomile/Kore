import type { OpenTask, TaskGroup } from '@reflect/core'
import { taskKey } from './task-identity'

/** The day a board group accepts drops for: an Upcoming day, or Today. */
export function boardDropDate(group: TaskGroup, today: string): string | null {
  if (group.kind === 'day' && group.date !== undefined) {
    return group.date
  }
  return group.kind === 'today' ? today : null
}

/**
 * Lay pending board moves (task key → target day) over the groups, so a
 * dropped card shows in its new column before the reindex re-buckets it. A
 * move whose task already sits in its target column is dropped from the
 * overlay; the rest move from wherever they are to the column for that day.
 */
export function applyBoardMoves(
  groups: readonly TaskGroup[],
  moves: ReadonlyMap<string, string>,
  today: string,
): TaskGroup[] {
  if (moves.size === 0) {
    return [...groups]
  }
  const moved: { task: OpenTask; date: string }[] = []
  const stripped = groups.map((group) => {
    const dropDate = boardDropDate(group, today)
    const tasks = group.tasks.filter((task) => {
      const date = moves.get(taskKey(task))
      if (date === undefined || date === dropDate) {
        return true
      }
      moved.push({ task, date })
      return false
    })
    return { ...group, tasks }
  })
  for (const { task, date } of moved) {
    const target = stripped.find((group) => boardDropDate(group, today) === date)
    target?.tasks.push(task)
  }
  return stripped
}

/** The moves still pending: those whose task hasn't landed on its day yet. */
export function pendingBoardMoves(
  groups: readonly TaskGroup[],
  moves: ReadonlyMap<string, string>,
  today: string,
): Map<string, string> {
  const pending = new Map(moves)
  for (const group of groups) {
    const dropDate = boardDropDate(group, today)
    for (const task of group.tasks) {
      const key = taskKey(task)
      if (pending.get(key) === dropDate) {
        pending.delete(key)
      }
    }
  }
  return pending
}
