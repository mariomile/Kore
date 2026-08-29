import type { ReactElement } from 'react'
import { Plus } from '@/components/icons'
import type { TaskGroup } from '@reflect/core'
import { addTargetForGroup, taskGroupHeaderStyle } from '@/lib/tasks/task-group-presentation'
import type { InsertTaskTarget } from '@/lib/tasks/task-insert-target'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'

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
 * allows one. A note group's label opens that note.
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

  return (
    <div className="flex items-center gap-2 bg-surface-sunken px-4 py-1.5 lg:px-12">
      <h2 className={cn('flex min-w-0 items-center gap-2 text-sm font-medium', labelClass)}>
        <span className={iconClass}>{icon}</span>
        {group.kind === 'note' && notePath !== null ? (
          <button
            type="button"
            onClick={(event) => onOpen(notePath, event)}
            className="truncate hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {group.label}
          </button>
        ) : (
          <span className="truncate">{group.label}</span>
        )}
      </h2>
      {addTarget !== null ? (
        <button
          type="button"
          aria-label={`Add a task to ${group.kind === 'current' ? 'today' : group.label}`}
          onClick={() => onAdd(addTarget)}
          className="ml-auto flex flex-none items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-text-muted transition-colors hover:text-text focus-visible:text-text focus-visible:outline-none"
        >
          <Plus aria-hidden className="size-3.5" />
          Add
        </button>
      ) : null}
    </div>
  )
}
