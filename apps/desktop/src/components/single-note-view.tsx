import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { NotePane } from '@/components/note-pane'
import { NoteOutlineRail } from '@/components/notes/note-outline-rail'
import { ScrollVeil } from '@/components/scroll-veil'
import { cn } from '@/lib/utils'
import { usePaneIsActive } from '@/providers/panes-provider'
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
  /**
   * Set when the view is a warm note tab (`WarmNoteViews`): false while the
   * tab is hidden. The view then keeps its scroll offset across hiding, which
   * a hidden container may drop, and coming back does not reset it.
   */
  shown?: boolean
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
export function SingleNoteView({
  path,
  dailyDate,
  heading,
  shown,
}: SingleNoteViewProps): ReactElement {
  // For the veil: the element itself, in state, so the veil's listener
  // attaches once ScrollRestored's container exists.
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  // Only the active pane's arrivals take the caret. A background pane that
  // re-navigates (the source of a moved tab falling back to its neighbour)
  // would otherwise focus its editor last and win both the caret and the
  // activation that the move just handed to the target pane. The answer is
  // latched per arrival, so a pane that merely becomes active later does not
  // yank the caret out of whatever the user just clicked.
  const paneIsActive = usePaneIsActive()
  const rootRef = useRef<HTMLDivElement>(null)
  // The offset as of the last scroll while shown. Read from the scroll
  // events, not at hide time: by the time a hiding commit's effects run the
  // container is already out of layout and may report 0.
  const shownScrollTop = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bindScrollElement = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element
    setScrollElement(element)
  }, [])
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (element !== null && shown === true) {
      element.scrollTop = shownScrollTop.current
    }
  }, [shown, scrollElement])
  const [arrival, setArrival] = useState({ path, autoFocus: paneIsActive })
  if (arrival.path !== path) {
    setArrival({ path, autoFocus: paneIsActive })
  }
  return (
    // The relative wrapper pins the floating outline rail to the viewport
    // edge of the pane while the note itself scrolls beneath it.
    <div ref={rootRef} className="relative h-full">
      <ScrollRestored
        className="h-full overflow-auto px-0"
        elementRef={bindScrollElement}
        keepUnsavedEntries={shown !== undefined}
        onScroll={(top) => {
          if (shown !== false) shownScrollTop.current = top
        }}
      >
        {/* With no heading the note opens the page, so its cover may bleed
            up through the top inset (`kore-note-page-top`). */}
        <div
          className={cn(
            'mx-auto flex min-h-full w-full max-w-full flex-col pt-14 pb-8',
            heading === undefined && 'kore-note-page-top',
          )}
        >
          {heading}
          <NotePane
            path={path}
            {...(dailyDate !== undefined ? { dailyDate } : {})}
            lazy
            autoFocus={arrival.autoFocus}
            className="flex grow flex-col"
            gutterClassName="kore-content-gutter"
            editorClassName="grow"
          />
        </div>
      </ScrollRestored>
      {/* Scrolled content melts at the pane's top edge instead of clipping
          against it (Plan 28). */}
      <ScrollVeil scrollElement={scrollElement} />
      {/* Below `md` the margin the rail floats in doesn't exist. */}
      <NoteOutlineRail scope={rootRef} className="right-1.5 hidden md:block" />
    </div>
  )
}
