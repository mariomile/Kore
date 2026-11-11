import type { ReactElement } from 'react'
import { Plus } from '@/components/icons'
import type { TaskGroup } from '@kore/core'
import { formatDayLabel } from '@/lib/dates'
import {
  addTargetForGroup,
  taskGroupHeaderStyle,
  taskGroupLabel,
} from '@/lib/tasks/task-group-presentation'
import type { InsertTaskTarget } from '@/lib/tasks/task-insert-target'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'

interface TaskGroupHeaderProps {
  group: TaskGroup
  /** Today's ISO date — the Current group's "+ Add" targets today's daily. */
  today: string
  /** Add a task to this group and open its editor (the header's "+ Add", V1). */
  onAdd: (target: InsertTaskTarget) => void
  onOpen: (notePath: string, event?: ModClickEvent) => void
}

/**
 * One task group's header (V1 design): a colour-coded icon + label — a date
 * bucket (Current/Overdue/Upcoming) or a note — with a "+ Add" button where V1
 * allows one. A note group's label opens that note. Only the Current group
 * (today) shows its "+ Add" at rest; on every other group it waits for the
 * pointer or focus, so a long list is not a column of identical buttons. The
 * header sits on the list's own surface: whitespace, not a tinted band,
 * separates one group from the next.
 *
 * Shared by {@link import('./task-list').TaskList}'s in-flow row and its pinned
 * stand-in for the active group (the two would otherwise drift on styling or
 * the add-target rule).
 */
export function TaskGroupHeader({
  group,
  today,
  onAdd,
  onOpen,
}: TaskGroupHeaderProps): ReactElement {
  const { notePath } = group
  const { icon, iconClass, labelClass } = taskGroupHeaderStyle(group)
  const addTarget = addTargetForGroup(group, today)
  const { settings } = useSettings()
  const label = taskGroupLabel(group, (iso) => formatDayLabel(iso, settings.dateFormat))
  const isToday = group.kind === 'current' || group.kind === 'today'

  return (
    <div className="group/header flex items-center gap-2 bg-surface px-4 py-1.5 lg:px-12">
      <h2 className={cn('flex min-w-0 items-center gap-3 text-sm font-medium', labelClass)}>
        {/* An 18px slot, like a row's checkbox, so icons and labels share its columns. */}
        <span className={cn('flex w-[18px] flex-none justify-center', iconClass)}>{icon}</span>
        {group.kind === 'note' && notePath !== null ? (
          <button
            type="button"
            onClick={(event) => onOpen(notePath, event)}
            className="truncate hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {label}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </h2>
      {addTarget !== null ? (
        <button
          type="button"
          aria-label={`Add a task to ${isToday ? 'today' : label}`}
          onClick={() => onAdd(addTarget)}
          className={cn(
            '-mr-1.5 ml-auto flex flex-none items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-text-muted transition-[color,opacity] hover:text-text focus-visible:text-text focus-visible:outline-none',
            !isToday && 'opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100',
          )}
        >
          <Plus aria-hidden className="size-3.5" />
          Add
        </button>
      ) : null}
    </div>
  )
}
