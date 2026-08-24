import type { ReactElement } from 'react'
import { CompanyApplySection } from './company-apply-section'
import { NoteActionsSection } from './note-actions-section'
import { NoteHistorySection } from './note-history-section'
import { NoteOutlineSection } from './note-outline-section'
import { NotePropertiesSection } from './note-properties-section'
import { PublishedUrlSection } from './published-url-section'
import { SimilarNotesSection } from './similar-notes-section'

interface NoteContextSidebarProps {
  /** Graph-relative path of the open note the sidebar describes. */
  path: string
}

/**
 * An ordinary note's contextual sidebar: note actions, the note's own shape
 * (its heading outline, which hides itself when there are no headings), then
 * its semantic neighbors — the only place similar notes appear. Inbound links
 * live under the note itself (the incoming-backlinks panel), not here.
 * Rendered in the AppShell's right region on `note` routes.
 */
export function NoteContextSidebar({ path }: NoteContextSidebarProps): ReactElement {
  return (
    <div className="flex flex-col py-2 text-text">
      <div className="my-4 space-y-4 pb-4">
        <NoteActionsSection path={path} showTrash />
        <CompanyApplySection path={path} />
        <NotePropertiesSection path={path} />
        <NoteOutlineSection />
        <PublishedUrlSection path={path} />
        <SimilarNotesSection path={path} />
        <NoteHistorySection path={path} />
      </div>
    </div>
  )
}
