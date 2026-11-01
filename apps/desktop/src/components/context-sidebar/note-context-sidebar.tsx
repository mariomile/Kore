import type { ReactElement } from 'react'
import { LocalGraphSection } from './local-graph-section'
import { NoteActionsSection } from './note-actions-section'
import { NoteHistorySection } from './note-history-section'
import { NoteOutlineSection } from './note-outline-section'
import { NoteTasksSection } from './note-tasks-section'
import { PublishedUrlSection } from './published-url-section'
import { SimilarNotesSection } from './similar-notes-section'

interface NoteContextSidebarProps {
  /** Graph-relative path of the open note the sidebar describes. */
  path: string
}

/**
 * An ordinary note's contextual sidebar, ordered by how often you look at it:
 * the note's open tasks, its shape (the heading outline, which hides itself
 * when there are no headings), its link neighborhood as a local graph, its
 * semantic neighbors (the only place similar notes appear), its history, and
 * last the note actions, which are commands you reach for rarely and which
 * the command palette and their shortcuts already cover. Properties are not
 * repeated here: the note's own page shows and edits them under the title.
 * Inbound links live under the note itself (the incoming-backlinks panel).
 * Rendered in the AppShell's right region on `note` routes.
 */
export function NoteContextSidebar({ path }: NoteContextSidebarProps): ReactElement {
  return (
    <div className="flex flex-col py-2 text-text">
      <div className="my-4 space-y-4 pb-4">
        <NoteTasksSection path={path} />
        <NoteOutlineSection />
        <LocalGraphSection path={path} />
        <PublishedUrlSection path={path} />
        <SimilarNotesSection path={path} />
        <NoteHistorySection path={path} />
        <NoteActionsSection path={path} showTrash />
      </div>
    </div>
  )
}
