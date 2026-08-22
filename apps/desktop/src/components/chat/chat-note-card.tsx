import type { MouseEvent, ReactElement } from 'react'
import { ChevronRight, FileText } from 'lucide-react'
import { displayNoteTitle, noteDirectiveTitle } from '@reflect/core'
import { isModEvent } from '@meowdown/core'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useNoteRow } from '@/hooks/use-note-row'
import { routeForPath } from '@/routing/route'

interface ChatNoteCardProps {
  /** Validated graph-relative note path from a `::note{…}` directive. */
  path: string
}

/**
 * A note promoted to a card in an assistant reply: the model emits
 * `::note{path="…"}` on a line of its own (already validated by
 * `parseNoteDirectives`) and the renderer swaps the line for this — the
 * note's live title over its path, opening the note on click (⌘-click in a
 * new window). The transcript keeps the plain directive line, so copies and
 * exports stay portable markdown.
 */
export function ChatNoteCard({ path }: ChatNoteCardProps): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const row = useNoteRow(path)
  const title = displayNoteTitle(row?.title ?? noteDirectiveTitle(path))

  const open = (event: MouseEvent<HTMLButtonElement>): void => {
    navigateNoteLink({ target: routeForPath(path), openInNewWindow: isModEvent(event) })
  }

  return (
    <button
      type="button"
      aria-label={`Open note ${title}`}
      onClick={open}
      className="group/note-card flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-left transition-colors duration-100 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
    >
      <FileText aria-hidden className="size-4 shrink-0 text-text-muted" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-text">{title}</span>
        <span className="block truncate text-xs text-text-muted">{path}</span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity duration-100 group-hover/note-card:opacity-100"
      />
    </button>
  )
}
