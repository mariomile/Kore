import { useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { parseQuickAdd, type QuickAdd, type QuickAddToken, type TaskProject } from '@reflect/core'
import {
  AlarmClock,
  ArrowRight,
  CalendarDays,
  Flag,
  Folder,
  Refresh,
  type Icon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/kbd'
import { formatShortDate } from '@/lib/dates'
import { quickAddRepeatLabel } from '@/lib/tasks/quick-add-labels'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

interface TaskQuickAddProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: string
  projects: readonly TaskProject[]
  /** Write the parsed task; resolves true once it's saved. */
  onSubmit: (parsed: QuickAdd) => Promise<boolean>
}

const TOKEN_ICON: Readonly<Record<QuickAddToken['kind'], Icon>> = {
  date: CalendarDays,
  time: AlarmClock,
  priority: Flag,
  repeat: Refresh,
  project: Folder,
}

/**
 * Quick Add (Todoist): one line in natural language — "call Anna tomorrow at
 * 3pm p1 #Kore" — parsed in core ({@link parseQuickAdd}) as you type. Chips
 * show what was understood and the line shows exactly what gets written, so a
 * wrong guess is visible before Return. Opens with `q` in the Tasks view.
 */
export function TaskQuickAdd({
  open,
  onOpenChange,
  today,
  projects,
  onSubmit,
}: TaskQuickAddProps): ReactElement {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const parsed = useMemo(() => parseQuickAdd(text, today, projects), [text, today, projects])

  const close = (next: boolean): void => {
    if (!next) {
      setText('')
    }
    onOpenChange(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (parsed.content === '' || pending) {
      return
    }
    setPending(true)
    try {
      if (await onSubmit(parsed)) {
        close(false)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        showCloseButton={false}
        className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Add task</DialogTitle>
        <DialogDescription className="sr-only">
          Type a task with its date, time, priority, repeat or #project in plain words.
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-col">
          <Input
            autoFocus
            value={text}
            disabled={pending}
            onChange={(event) => setText(event.target.value)}
            placeholder="Call Anna tomorrow at 3pm p1 #Project"
            aria-label="Task"
            className="h-12 rounded-none border-0 bg-transparent px-4 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
          />
          <QuickAddChips parsed={parsed} className="px-4 pb-3" />
          <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
            <p className="min-w-0 flex-1 break-words text-xs leading-5 text-text-muted">
              {parsed.content === '' ? (
                <>Add to {parsed.project?.title ?? 'today’s note'}</>
              ) : (
                <>
                  <span className="text-text-secondary">
                    {parsed.project?.title ?? 'Today’s note'}:
                  </span>{' '}
                  <span data-testid="quick-add-preview" className="font-mono">
                    {parsed.content}
                  </span>
                </>
              )}
            </p>
            <Kbd>esc</Kbd>
            <Button
              type="submit"
              size="sm"
              disabled={pending || parsed.content === ''}
              className="gap-1.5"
            >
              {pending ? 'Adding…' : 'Add task'}
              <ArrowRight aria-hidden className="size-3.5" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** What Quick Add understood, one chip per recognized token (`title` names the typed words). */
export function QuickAddChips({
  parsed,
  className,
}: {
  parsed: QuickAdd
  className?: string
}): ReactElement | null {
  const { settings } = useSettings()
  if (parsed.tokens.length === 0) {
    return null
  }
  const label = (token: QuickAddToken): string => {
    switch (token.kind) {
      case 'date':
        return parsed.dueDate === null
          ? token.text
          : formatShortDate(parsed.dueDate, settings.dateFormat)
      case 'time':
        return parsed.dueTime ?? token.text
      case 'priority':
        return parsed.priority === 'high'
          ? 'High priority'
          : parsed.priority === 'medium'
            ? 'Medium priority'
            : 'No priority'
      case 'repeat':
        return quickAddRepeatLabel(parsed.repeat)
      case 'project':
        return parsed.project?.title ?? token.text
    }
  }
  return (
    <ul aria-label="Understood" className={cn('flex flex-wrap gap-1.5', className)}>
      {parsed.tokens.map((token) => {
        const Glyph = TOKEN_ICON[token.kind]
        return (
          <li
            key={`${token.kind}:${token.start}`}
            title={`From “${token.text}”`}
            className="flex h-6 items-center gap-1 rounded-md bg-accent-soft px-2 text-xs text-accent-soft-text"
          >
            <Glyph aria-hidden className="size-3.5" />
            {label(token)}
          </li>
        )
      })}
    </ul>
  )
}
