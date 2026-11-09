import { useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { Virtualizer } from 'virtua'
import type { OpenTask, TaskGroup } from '@reflect/core'
import { CheckCircle, Circle, Plus } from '@/components/icons'
import { applyBoardMoves, boardDropDate, pendingBoardMoves } from '@/lib/tasks/task-board-moves'
import {
  addTargetForGroup,
  taskGroupHeaderStyle,
  taskGroupLabel,
} from '@/lib/tasks/task-group-presentation'
import { taskKey } from '@/lib/tasks/task-identity'
import type { InsertTaskTarget } from '@/lib/tasks/task-insert-target'
import { useTaskCheckboxToggle } from '@/lib/tasks/use-task-checkbox-toggle'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { TaskSourceLink } from './task-source-link'
import { TaskText } from './task-text'

interface TaskBoardProps {
  groups: readonly TaskGroup[]
  today: string
  formatDay: (iso: string) => string
  /** Add a task to a column (its "+"), like a list group's "+ Add". */
  onAdd: (target: InsertTaskTarget) => void
  /** Give the dropped task a due date — a drop on an Upcoming day or Today. */
  onSchedule: (task: OpenTask, isoDate: string) => void
  onOpen: (notePath: string, event?: ModClickEvent) => void
}

/**
 * The Tasks board (Kanban): the open view's groups as columns — Upcoming's
 * days, Today's Overdue/Today, Projects' projects. A card drags onto an
 * Upcoming day or Today to take that due date (the same `[[YYYY-MM-DD]]`
 * write the schedule calendar does); an optimistic overlay shows it in the
 * new column until the reindex re-buckets it. Columns without a day (Overdue,
 * Inbox, Later, a project) refuse drops: moving a task between notes is a
 * later slice. Each column's list is virtualized, like the collection board.
 * The list layout stays the keyboard path.
 */
export function TaskBoard({
  groups,
  today,
  formatDay,
  onAdd,
  onSchedule,
  onOpen,
}: TaskBoardProps): ReactElement {
  const [moves, setMoves] = useState<ReadonlyMap<string, string>>(new Map())
  const [dragging, setDragging] = useState<OpenTask | null>(null)
  const [dropColumn, setDropColumn] = useState<string | null>(null)

  // Drop moves the reindex has caught up with, so the overlay stays small.
  const pending = useMemo(() => pendingBoardMoves(groups, moves, today), [groups, moves, today])
  if (pending.size !== moves.size) {
    setMoves(pending)
  }
  const columns = useMemo(() => applyBoardMoves(groups, pending, today), [groups, pending, today])

  const endDrag = (): void => {
    setDragging(null)
    setDropColumn(null)
  }

  return (
    <div className="flex h-full items-stretch gap-4 overflow-x-auto px-4 pb-6 lg:px-12">
      {columns.map((group) => {
        const label = taskGroupLabel(group, formatDay)
        const columnKey =
          group.kind === 'note' ? `note:${group.notePath}` : `${group.kind}:${label}`
        const dropDate = boardDropDate(group, today)
        const addTarget = addTargetForGroup(group, today)
        const { icon, iconClass, labelClass } = taskGroupHeaderStyle(group)
        return (
          <section
            key={columnKey}
            aria-label={label}
            className={cn(
              'flex max-h-full w-64 flex-none flex-col rounded-xl bg-surface-hover/60 p-2',
              dragging !== null && dropColumn === columnKey && 'ring-2 ring-accent/60',
            )}
            onDragOver={(event) => {
              if (dragging !== null && dropDate !== null) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropColumn(columnKey)
              }
            }}
            onDragLeave={(event: DragEvent<HTMLElement>) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropColumn((current) => (current === columnKey ? null : current))
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              const task = dragging
              endDrag()
              if (task === null || dropDate === null || task.dueDate === dropDate) {
                return
              }
              setMoves((current) => new Map(current).set(taskKey(task), dropDate))
              onSchedule(task, dropDate)
            }}
          >
            <header className="flex flex-none items-center gap-1.5 px-2 py-1.5">
              <span className={iconClass}>{icon}</span>
              {group.kind === 'note' && group.notePath !== null ? (
                <button
                  type="button"
                  onClick={(event) => onOpen(group.notePath!, event)}
                  className={cn(
                    'min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline',
                    labelClass,
                  )}
                >
                  {label}
                </button>
              ) : (
                <h2 className={cn('min-w-0 flex-1 truncate text-xs font-medium', labelClass)}>
                  {label}
                </h2>
              )}
              <span className="text-xs tabular-nums text-text-muted">{group.tasks.length}</span>
              {addTarget !== null ? (
                <button
                  type="button"
                  aria-label={`Add a task to ${label}`}
                  onClick={() => onAdd(addTarget)}
                  className="flex size-4 items-center justify-center rounded-sm text-text-muted hover:text-text-secondary"
                >
                  <Plus aria-hidden className="size-3" />
                </button>
              ) : null}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Virtualizer data={group.tasks} itemSize={56} bufferSize={400}>
                {(task) => (
                  <div key={taskKey(task)} className="pb-1.5">
                    <TaskBoardCard
                      task={task}
                      showSource={group.kind !== 'note' || task.notePath !== group.notePath}
                      dragging={dragging !== null && taskKey(dragging) === taskKey(task)}
                      onDragStart={(event) => {
                        setDragging(task)
                        event.dataTransfer.setData('text/plain', taskKey(task))
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={endDrag}
                      onOpen={onOpen}
                    />
                  </div>
                )}
              </Virtualizer>
            </div>
          </section>
        )
      })}
    </div>
  )
}

interface TaskBoardCardProps {
  task: OpenTask
  showSource: boolean
  dragging: boolean
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onOpen: (notePath: string, event?: ModClickEvent) => void
}

/** One board card: the checkbox, the task's rendered content, and its source. */
function TaskBoardCard({
  task,
  showSource,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: TaskBoardCardProps): ReactElement {
  const { toggle, isPending } = useTaskCheckboxToggle(task)
  const label = task.text || 'Empty task'
  return (
    <article
      data-task-key={taskKey(task)}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group/task flex cursor-grab items-start gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-sm active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <button
        type="button"
        aria-label={task.checked ? `Reopen: ${label}` : `Complete: ${label}`}
        disabled={isPending}
        onClick={toggle}
        className="flex h-6 shrink-0 items-center text-text-muted transition-colors hover:text-text focus-visible:text-text focus-visible:outline-none disabled:cursor-default"
      >
        {task.checked ? (
          <CheckCircle aria-hidden className="size-4 text-accent" />
        ) : (
          <Circle aria-hidden className="size-4" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          className={cn(
            'min-w-0 break-words text-sm leading-6 text-text',
            task.checked && 'text-text-muted line-through',
          )}
        >
          <TaskText task={task} />
        </div>
        <TaskSourceLink task={task} labelled={showSource} onOpen={onOpen} className="self-start" />
      </div>
    </article>
  )
}
