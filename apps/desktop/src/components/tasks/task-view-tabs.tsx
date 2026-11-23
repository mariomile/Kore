import type { ReactElement } from 'react'
import { TASK_VIEWS, type TaskView } from '@kore/core'
import { BoardView, List } from '@/components/icons'
import { taskViewLabel } from '@/lib/tasks/task-view-labels'
import type { TaskLayout } from '@/lib/tasks/use-task-view'
import { cn } from '@/lib/utils'

const VIEW_SHORTCUTS: Readonly<Record<TaskView, string>> = {
  inbox: 'G then I',
  today: 'G then T',
  upcoming: 'G then U',
  projects: 'G then P',
  all: 'G then A',
}

interface TaskViewTabsProps {
  view: TaskView
  counts: Readonly<Record<TaskView, number>>
  onSelect: (view: TaskView) => void
}

/**
 * The Tasks view switcher (Todoist): Inbox / Today / Upcoming / Projects / All,
 * each with its open count, as the same segmented pill the Notes header
 * filters with. `g` then a view's letter switches from the keyboard
 * ({@link useTaskKeyboard}).
 */
export function TaskViewTabs({ view, counts, onSelect }: TaskViewTabsProps): ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Task views"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-surface-hover p-0.5"
    >
      {TASK_VIEWS.map((entry) => {
        const label = taskViewLabel(entry)
        const selected = entry === view
        return (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={selected}
            title={`${label} (${VIEW_SHORTCUTS[entry]})`}
            onClick={() => onSelect(entry)}
            className={cn(
              'flex h-6 flex-none items-baseline gap-1.5 rounded-full px-2.5 text-[13px] leading-6 font-medium transition-colors duration-100',
              selected
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {label}
            <span className="text-xs font-normal tabular-nums text-text-muted">
              {counts[entry]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

interface TaskLayoutToggleProps {
  layout: TaskLayout
  onLayoutChange: (layout: TaskLayout) => void
}

/** The List / Board toggle, the same pill as the Notes list / grid toggle. */
export function TaskLayoutToggle({ layout, onLayoutChange }: TaskLayoutToggleProps): ReactElement {
  return (
    <div
      role="group"
      aria-label="Layout"
      className="flex flex-none items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
    >
      {(['list', 'board'] as const).map((entry) => {
        const Glyph = entry === 'list' ? List : BoardView
        const label = entry === 'list' ? 'List' : 'Board'
        return (
          <button
            key={entry}
            type="button"
            aria-label={`${label} layout`}
            aria-pressed={layout === entry}
            title={label}
            onClick={() => onLayoutChange(entry)}
            className={cn(
              'flex size-6 items-center justify-center rounded-full transition-colors duration-100',
              layout === entry
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            <Glyph aria-hidden className="size-3.5" />
          </button>
        )
      })}
    </div>
  )
}
