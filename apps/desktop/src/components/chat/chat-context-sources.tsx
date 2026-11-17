import { useId, useState, type MouseEvent, type ReactElement } from 'react'
import { displayNoteTitle, type ContextNote } from '@kore/core'
import { isModEvent } from '@meowdown/core'
import { ChevronRight, Note, Notes } from '@/components/icons'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { cn } from '@/lib/utils'
import { routeForPath } from '@/routing/route'

interface ChatContextSourcesProps {
  notes: readonly ContextNote[]
}

/** The folder a note lives in, for the muted trailing label; '' at the vault root. */
function noteFolder(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/**
 * The notes that rode along with a request, as a quiet pill above the reply:
 * "Used 3 notes". Context is provenance, not the answer, so it starts
 * collapsed and stays one line tall; opening it lists one compact row per
 * note (title, folder) that opens the note on click (⌘-click: split pane).
 * The captured excerpt is the row's tooltip, so what was sent stays
 * inspectable after a restart without printing raw passages into the
 * transcript. Mentions are marked; automatic recall is the unmarked default.
 */
export function ChatContextSources({ notes }: ChatContextSourcesProps): ReactElement {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const count = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`

  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((value) => !value)
        }}
        className="group/context inline-flex h-6 max-w-full items-center gap-1.5 rounded-full pointer-coarse:h-8 bg-surface-hover/60 pr-2 pl-2.5 text-xs text-text-muted transition-colors duration-100 hover:bg-surface-hover hover:text-text-secondary aria-expanded:bg-surface-hover aria-expanded:text-text-secondary"
      >
        <Notes aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">Used {count}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3 shrink-0 transition-transform duration-150 ease-swift motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      {open ? (
        <ul
          id={listId}
          aria-label="Notes used for this reply"
          className="flex w-full max-w-md min-w-0 flex-col"
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

/** One context note as a compact row: title, folder, open on click. */
export function ContextNoteRow({ note }: { note: ContextNote }): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const title = displayNoteTitle(note.title)
  const folder = noteFolder(note.path)

  const open = (event: MouseEvent<HTMLButtonElement>): void => {
    navigateNoteLink({ target: routeForPath(note.path), openInSplit: isModEvent(event) })
  }

  return (
    <button
      type="button"
      onClick={open}
      title={note.excerpt}
      aria-label={`Open note ${title}`}
      className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left transition-colors duration-100 hover:bg-surface-hover pointer-coarse:h-11"
    >
      <Note aria-hidden className="size-3.5 shrink-0 text-text-muted" />
      <span className="min-w-0 shrink truncate text-sm text-text">{title}</span>
      {folder !== '' ? (
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{folder}</span>
      ) : (
        <span className="flex-1" />
      )}
      {note.source === 'mention' ? (
        <span className="shrink-0 text-xs text-text-muted">Mentioned</span>
      ) : null}
    </button>
  )
}
