import type { ReactElement } from 'react'
import type { OpenTask } from '@reflect/core'
import { Note } from '@/components/icons'
import { formatShortDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'

interface TaskSourceLinkProps {
  task: OpenTask
  /**
   * Name the note (its daily date or title). Off under a note group's header,
   * which already names it: then only the note glyph shows, on hover.
   */
  labelled: boolean
  onOpen: (notePath: string, event?: ModClickEvent) => void
  className?: string
}

/**
 * The way from a task to the note it lives in. The note glyph marks it as a
 * link to a note, so a daily note's date doesn't read as the task's due date.
 * ⌘-click opens the note in a split.
 */
export function TaskSourceLink({
  task,
  labelled,
  onOpen,
  className,
}: TaskSourceLinkProps): ReactElement {
  const { settings } = useSettings()
  const name =
    task.dailyDate !== null ? formatShortDate(task.dailyDate, settings.dateFormat) : task.noteTitle
  return (
    <button
      type="button"
      aria-label={`Open note: ${name}`}
      title={`Open ${name} (⌘-click: split)`}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(task.notePath, event)
      }}
      className={cn(
        'flex h-6 min-w-0 shrink-0 items-center gap-1 whitespace-nowrap text-xs text-text-muted transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-none',
        !labelled && 'opacity-0 focus-visible:opacity-100 group-hover/task:opacity-100',
        className,
      )}
    >
      <Note aria-hidden className="size-3.5 shrink-0" />
      {labelled ? <span className="truncate">{name}</span> : null}
    </button>
  )
}
