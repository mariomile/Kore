import type { ReactElement } from 'react'
import { TASK_VIEWS, type TaskView } from '@reflect/core'
import {
  CalendarDays,
  Folder,
  Inbox,
  LayoutTemplate,
  List,
  Notes,
  Star,
  type Icon,
} from '@/components/icons'
import { taskViewLabel } from '@/lib/tasks/task-view-labels'
import type { TaskLayout } from '@/lib/tasks/use-task-view'
import { cn } from '@/lib/utils'

const VIEW_META: Readonly<Record<TaskView, { glyph: Icon; shortcut: string }>> = {
  inbox: { glyph: Inbox, shortcut: 'G then I' },
  today: { glyph: Star, shortcut: 'G then T' },
  upcoming: { glyph: CalendarDays, shortcut: 'G then U' },
  projects: { glyph: Folder, shortcut: 'G then P' },
  all: { glyph: Notes, shortcut: 'G then A' },
}

interface TaskViewTabsProps {
  view: TaskView
  counts: Readonly<Record<TaskView, number>>
  onSelect: (view: TaskView) => void
  layout: TaskLayout
  onLayoutChange: (layout: TaskLayout) => void
}

/**
 * The Tasks view switcher (Todoist): Inbox / Today / Upcoming / Projects / All,
 * each with its open count, plus the List / Board layout toggle. `g` then a
 * view's letter switches from the keyboard ({@link useTaskKeyboard}).
 */
export function TaskViewTabs({
  view,
  counts,
  onSelect,
  layout,
  onLayoutChange,
}: TaskViewTabsProps): ReactElement {
  return (
    <div className="flex flex-none items-center gap-2 px-2 pb-2 lg:px-10">
      <div
        role="tablist"
        aria-label="Task views"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
      >
        {TASK_VIEWS.map((entry) => {
          const { glyph: Glyph, shortcut } = VIEW_META[entry]
          const label = taskViewLabel(entry)
          const selected = entry === view
          return (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={selected}
              title={`${label} (${shortcut})`}
              onClick={() => onSelect(entry)}
              className={cn(
                'flex flex-none items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
                selected
                  ? 'bg-surface-hover text-text'
                  : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary',
              )}
            >
              <Glyph aria-hidden className="size-3.5 shrink-0" />
              {label}
              <span className="text-xs tabular-nums text-text-muted">{counts[entry]}</span>
            </button>
          )
        })}
      </div>
      <div role="group" aria-label="Layout" className="ml-auto flex flex-none items-center gap-0.5">
        {(['list', 'board'] as const).map((entry) => {
          const Glyph = entry === 'list' ? List : LayoutTemplate
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
                'app-icon-button',
                layout === entry ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text',
              )}
            >
              <Glyph aria-hidden className="size-3.5" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
