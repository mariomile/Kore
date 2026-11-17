import { useId, useState, type MouseEvent, type ReactElement } from 'react'
import { displayNoteTitle, type ContextNote } from '@kore/core'
import { isModEvent } from '@meowdown/core'
import { ChevronDown, Note } from '@/components/icons'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { cn } from '@/lib/utils'
import { routeForPath } from '@/routing/route'

interface ChatContextSourcesProps {
  notes: readonly ContextNote[]
}

/** Tiles the collapsed pill stacks before the count takes over. */
const STACK_MAX = 3

/** The folder a note lives in as a breadcrumb (`CRM › Companies`); '' at the vault root. */
function folderCrumb(path: string): string {
  return path.split('/').slice(0, -1).join(' › ')
}

/** The letter a note's tile shows: its title's first letter or digit, or null. */
function noteInitial(title: string): string | null {
  const match = /[\p{L}\p{N}]/u.exec(title)
  return match ? match[0].toLocaleUpperCase() : null
}

/**
 * A note's square tile: its initial on a quiet ground, the note glyph when
 * the title starts with neither a letter nor a digit. The collapsed pill
 * stacks the small size; rows use the large one, so the two read as the same
 * object at two zoom levels.
 */
function NoteTile({ title, size }: { title: string; size: 'sm' | 'lg' }): ReactElement {
  const initial = noteInitial(title)
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center bg-surface font-semibold text-text-secondary',
        size === 'sm'
          ? 'size-[18px] rounded-[5px] text-[9px] leading-none ring-[1.5px] ring-surface-hover'
          : 'size-7 rounded-lg text-xs shadow-[inset_0_0_0_1px_var(--border)]',
      )}
    >
      {initial ?? <Note className={size === 'sm' ? 'size-2.5' : 'size-3.5'} />}
    </span>
  )
}

/**
 * The notes that rode along with a request, as one quiet pill above the
 * reply: the first notes' tiles stacked, then the count. Context is
 * provenance, not the answer, so it starts collapsed; opening it unfolds a
 * soft card with one row per note (tile, title, where it lives) that opens
 * the note on click (⌘-click: split pane). The captured excerpt is the row's
 * tooltip, so what was sent stays inspectable after a restart without
 * printing raw passages into the transcript.
 */
export function ChatContextSources({ notes }: ChatContextSourcesProps): ReactElement {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const count = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Used ${count}`}
        onClick={() => {
          setOpen((value) => !value)
        }}
        className="group/context inline-flex h-7 max-w-full items-center gap-2 rounded-full bg-surface-hover pr-2.5 pl-1.5 text-xs text-text-secondary transition-colors duration-100 hover:text-text pointer-coarse:h-9 pointer-coarse:pl-2"
      >
        <span className="flex items-center pl-0.5 *:not-first:-ml-1">
          {notes.slice(0, STACK_MAX).map((note) => (
            <NoteTile key={`${note.source}:${note.path}`} title={note.title} size="sm" />
          ))}
        </span>
        <span className="truncate">{count}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-text-muted transition-transform duration-150 ease-swift motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <ul
          id={listId}
          aria-label="Notes used for this reply"
          className="flex w-full max-w-lg min-w-0 flex-col rounded-xl bg-surface-hover/50 p-1"
        >
          {notes.map((note) => (
            <li key={`${note.source}:${note.path}`} className="min-w-0">
              <ContextNoteRow note={note} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * One context note as a row: its tile, the title, and a second line saying
 * where it lives (and that you mentioned it, when you did). Opens the note.
 */
export function ContextNoteRow({ note }: { note: ContextNote }): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const title = displayNoteTitle(note.title)
  const crumb = folderCrumb(note.path)
  const detail = [note.source === 'mention' ? 'Mentioned' : '', crumb]
    .filter((part) => part !== '')
    .join(' · ')

  const open = (event: MouseEvent<HTMLButtonElement>): void => {
    navigateNoteLink({ target: routeForPath(note.path), openInSplit: isModEvent(event) })
  }

  return (
    <button
      type="button"
      onClick={open}
      title={note.excerpt}
      aria-label={`Open note ${title}`}
      className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-100 hover:bg-surface-hover"
    >
      <NoteTile title={title} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-5 text-text">{title}</span>
        {detail !== '' ? (
          <span className="truncate text-xs leading-4 text-text-muted">{detail}</span>
        ) : null}
      </span>
    </button>
  )
}
