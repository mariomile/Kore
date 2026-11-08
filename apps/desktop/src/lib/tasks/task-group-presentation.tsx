import type { ReactElement } from 'react'
import {
  AlarmClock,
  Calendar,
  CalendarDays,
  Folder,
  Inbox,
  Note,
  Pin,
  Star,
} from '@/components/icons'
import type { TaskGroup } from '@reflect/core'
import type { InsertTaskTarget } from '@/lib/tasks/task-insert-target'
import { dailyTarget, insertTargetForTask, todaysDailyTarget } from '@/lib/tasks/task-navigation'

/**
 * The presentation contract a task-group section shares across surfaces —
 * V1's per-bucket styling and add-target rule, one definition for the desktop
 * sections and the mobile groups so the two can't drift on bucket colours or
 * where "+ Add" writes.
 */

export interface TaskGroupHeaderStyle {
  icon: ReactElement
  /** The icon's colour — labels always read as ink; the icon whispers. */
  iconClass: string
  /** The label's colour — ink, except Overdue's genuine alarm. */
  labelClass: string
}

/**
 * The icon + colour for a group's sticky header. Mono-accent discipline (a
 * departure from V1's amber/green category coding): labels read as ink,
 * icons stay quiet, and only the two semantic voices speak in colour — the
 * accent for "now" (Current, pinned) and destructive for Overdue.
 */
export function taskGroupHeaderStyle(group: TaskGroup): TaskGroupHeaderStyle {
  switch (group.kind) {
    case 'current':
    case 'today':
      return {
        icon: <Star aria-hidden className="size-4" />,
        iconClass: 'text-accent',
        labelClass: 'text-text',
      }
    case 'overdue':
      return {
        icon: <AlarmClock aria-hidden className="size-4" />,
        iconClass: 'text-destructive',
        labelClass: 'text-destructive',
      }
    case 'inbox':
      return {
        icon: <Inbox aria-hidden className="size-4" />,
        iconClass: 'text-accent',
        labelClass: 'text-text',
      }
    case 'day':
      return {
        icon: <CalendarDays aria-hidden className="size-4" />,
        iconClass: 'text-text-muted',
        labelClass: 'text-text',
      }
    case 'upcoming':
    case 'later':
      return {
        icon: <Calendar aria-hidden className="size-4" />,
        iconClass: 'text-text-muted',
        labelClass: 'text-text',
      }
    case 'note':
      if (group.notePath !== null && group.tasks[0]?.notePath !== group.notePath) {
        // A Projects group gathered under a folder note.
        return {
          icon: <Folder aria-hidden className="size-4" />,
          iconClass: 'text-text-muted',
          labelClass: 'text-text',
        }
      }
      return group.tasks[0]?.isPinned
        ? {
            icon: <Pin aria-hidden className="size-4" />,
            iconClass: 'text-accent',
            labelClass: 'text-text',
          }
        : {
            icon: <Note aria-hidden className="size-4" />,
            iconClass: 'text-text-muted',
            labelClass: 'text-text-secondary',
          }
  }
}

/**
 * Where this group's add button adds a task (V1: Current/Today → today's
 * daily, an Upcoming day → that day's daily, a note → that note), or `null`
 * for the aggregate Overdue/Upcoming/Later/Inbox groups, which span many notes
 * and so show no add button.
 */
export function addTargetForGroup(group: TaskGroup, today: string): InsertTaskTarget | null {
  if (group.kind === 'current' || group.kind === 'today') {
    return todaysDailyTarget(today)
  }
  if (group.kind === 'day' && group.date !== undefined) {
    return dailyTarget(group.date)
  }
  const first = group.tasks[0]
  return group.kind === 'note' && first !== undefined ? insertTargetForTask(first) : null
}

/** A group's display label: an Upcoming day reads as a date, the rest as named. */
export function taskGroupLabel(group: TaskGroup, formatDay: (iso: string) => string): string {
  return group.kind === 'day' && group.date !== undefined ? formatDay(group.date) : group.label
}
