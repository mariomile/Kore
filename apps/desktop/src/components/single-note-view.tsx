import { useState, type ReactElement, type ReactNode } from 'react'
import { NotePane } from '@/components/note-pane'
import { NoteOutlineRail } from '@/components/notes/note-outline-rail'
import { ScrollVeil } from '@/components/scroll-veil'
import { ScrollRestored } from '@/routing/scroll-restore'

interface SingleNoteViewProps {
  /** Graph-relative path of the note filling this view. */
  path: string
  /**
   * The day this pane shows, when the note is a daily — forwarded to
   * {@link NotePane} so daily behavior (day-keyed handles) holds outside the
   * stream.
   */
  dailyDate?: string
  /**
   * Chrome rendered above the pane inside the scrolling column — the note
   * window's day label, standing in for the title a daily doesn't carry.
   */
  heading?: ReactNode
}

/**
 * One note filling the viewport: the note route's layout, shared with the
 * secondary note window (which renders dailies this way too). The vertical
 * padding lives on the inner column — not the scroll container — so
 * `min-h-full` fills the viewport exactly, and the flex chain stretches the
 * editor over any leftover space. The reading gutter is the editor's own
 * padding, so clicking anywhere in the note body (blank side margins
 * included) focuses it.
 */
export function SingleNoteView({ path, dailyDate, heading }: SingleNoteViewProps): ReactElement {
  // For the veil: the element itself, in state, so the veil's listener
  // attaches once ScrollRestored's container exists.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  return (
    // The relative wrapper pins the floating outline rail to the viewport
    // edge of the pane while the note itself scrolls beneath it.
    <div className="relative h-full">
      <ScrollRestored className="h-full overflow-auto px-0" elementRef={setScrollElement}>
        <div className="mx-auto flex min-h-full w-full max-w-full flex-col pt-14 pb-8">
          {heading}
          <NotePane
            path={path}
            {...(dailyDate !== undefined ? { dailyDate } : {})}
            lazy
            autoFocus
            className="flex grow flex-col"
            gutterClassName="reflect-content-gutter"
            editorClassName="grow"
          />
        </div>
      </ScrollRestored>
      {/* Scrolled content melts at the pane's top edge instead of clipping
          against it (Plan 28). */}
      <ScrollVeil scrollElement={scrollElement} />
      <NoteOutlineRail />
    </div>
  )
}
