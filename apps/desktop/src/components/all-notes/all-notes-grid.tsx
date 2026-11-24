import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import {
  displayNoteTitle,
  type CollectionEntry,
  type NoteListEntry,
  type TagType,
} from '@kore/core'
import { Notes, Pin } from '@/components/icons'
import { TagChips } from '@/components/tags/tag-chips'
import { EmptyState } from '@/components/ui/empty-state'
import { noImageUrl, useFirstImages, usePassiveImageResolver } from '@/hooks/use-note-card-images'
import { formatRecencyLabel } from '@/lib/dates'
import { columnsThatFit, dealIntoColumns } from '@/lib/deal-columns'
import { cn } from '@/lib/utils'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'
import { CardPreviewSlot } from './card-preview-slot'
import { CardPropertyChips } from './card-property-chips'
import { GRID_CARD_BUTTON_CLASS, GRID_CARD_CLASS } from './grid-card-classes'
import { NoteCardPicture } from './note-card-picture'
import { NoteCardPreview } from './note-card-preview'

interface AllNotesGridProps {
  notes: readonly NoteListEntry[] | undefined
  /** Active tag filter — only used for the empty state's phrasing. */
  tag: string | null
  /** The routed tag's schema, when it has one — cards then carry chips. */
  type?: TagType | null
  /** The typed tag's collection rows, for the property values by path. */
  entries?: readonly CollectionEntry[] | undefined
  onOpen: (path: string, event?: ModClickEvent) => void
}

/** How many cards mount at once; scrolling near the end reveals the next batch. */
const GRID_CHUNK = 120

/** A card's footer names this many of the note's tags. */
const MAX_FOOTER_TAGS = 3

/** A column is at least this wide (17rem), with this gap (1.25rem) between columns. */
const COLUMN_MIN_WIDTH = 272
const COLUMN_GAP = 20

/** Before the grid is measured (only ever seen by tests without layout). */
const DEFAULT_COLUMNS = 3

/** How long a resize rests before the columns are dealt again. */
const RESIZE_SETTLE_MS = 150

/**
 * How far from the screen a card's preview is prepared: about a screen, so
 * scrolling lands on cards that already have their own height.
 */
const PREPARE_MARGIN = '800px'

/**
 * The All Notes masonry view (Plan 28, Craft's register): the same notes as
 * the table, as live-preview cards, each note's actual rendered content at
 * the compact hover-card scale. Cards are as tall as their notes, dealt row
 * by row into as many columns as fit (lib/deal-columns.ts), the same layout
 * as the phone grid: a short note is a short card, a long one stops at a
 * capped height on a whole line, and a card that leads with its picture
 * never stretches its neighbors. A reading layout, not a management one:
 * cards open on click (⌘-click in the pane beside this one); multi-select
 * and its keyboard shortcuts stay with the table view. Instead of the
 * table's row virtualizer the grid mounts in chunks: a sentinel below the
 * cards reveals the next {@link GRID_CHUNK} as it scrolls into reach, so a
 * many-thousand-note graph never mounts every card at once.
 */
export function AllNotesGrid({
  notes,
  tag,
  type,
  entries,
  onOpen,
}: AllNotesGridProps): ReactElement | null {
  const { settings } = useSettings()
  const [visibleCount, setVisibleCount] = useState(GRID_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMore = notes !== undefined && notes.length > visibleCount
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState({ count: DEFAULT_COLUMNS, width: 0 })
  // The parent passes a fresh onOpen each render; a stable one lets the
  // memoized cards skip re-rendering when only the thumbnails arrive.
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const openNote = useCallback(
    (path: string, event?: ModClickEvent) => onOpenRef.current(path, event),
    [],
  )
  // The typed tag page's property values, by path — the grid's rows come
  // from the notes list, the chips from the collection projection.
  const entryByPath = useMemo(
    () => new Map((entries ?? []).map((entry) => [entry.path, entry])),
    [entries],
  )

  // One resolver for every card: asset URLs are graph-relative, so nothing
  // per-note is involved. The passive no-network boundary is the wiki-link
  // hover card's, shared — see editor/preview-image-url.ts.
  const resolvePreviewImageUrl = usePassiveImageResolver()
  const mountedNotes = useMemo(() => notes?.slice(0, visibleCount) ?? [], [notes, visibleCount])
  // Each note's picture (its cover, else its first image), as a cached
  // card-sized thumbnail: one indexed query per mounted chunk.
  const pictures = useFirstImages(
    useMemo(() => mountedNotes.map((note) => note.path), [mountedNotes]),
  )

  // As many columns as the grid's content width fits, measured before the
  // first paint so a narrow pane never flashes the default count. The column
  // width joins each card's height key (a preview's kept height is only good
  // for the width it was measured at), so it settles once a resize rests:
  // the cards then re-measure once instead of on every frame of a drag.
  useLayoutEffect(() => {
    if (gridElement === null) {
      return
    }
    let settle: number | null = null
    const measure = (): { count: number; width: number } => {
      const style = getComputedStyle(gridElement)
      const width =
        gridElement.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight)
      const count = columnsThatFit(width, COLUMN_MIN_WIDTH, COLUMN_GAP)
      return { count, width: Math.round((width - COLUMN_GAP * (count - 1)) / count) }
    }
    const apply = (next: { count: number; width: number }): void => {
      setColumns((current) =>
        current.count === next.count && current.width === next.width ? current : next,
      )
    }
    apply(measure())
    const observer = new ResizeObserver(() => {
      if (settle !== null) {
        window.clearTimeout(settle)
      }
      settle = window.setTimeout(() => apply(measure()), RESIZE_SETTLE_MS)
    })
    observer.observe(gridElement)
    return () => {
      observer.disconnect()
      if (settle !== null) {
        window.clearTimeout(settle)
      }
    }
  }, [gridElement])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!hasMore || sentinel === null) {
      return
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + GRID_CHUNK)
        }
      },
      // Start mounting the next chunk well before the sentinel is on screen.
      { rootMargin: '600px' },
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, visibleCount])

  if (notes === undefined) {
    return null
  }
  if (notes.length === 0) {
    return (
      <EmptyState
        icon={Notes}
        title={tag === null ? 'No notes yet' : `No #${tag} notes yet`}
        description="Notes that belong here show up as soon as they exist."
      />
    )
  }
  return (
    <div
      ref={setGridElement}
      data-testid="all-notes-grid"
      className="flex items-start gap-5 pb-10 pl-12 pr-7 pt-2"
    >
      {dealIntoColumns(mountedNotes, columns.count).map((column, columnIndex) => (
        <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-5">
          {column.map((note) => (
            <GridCard
              key={note.path}
              columnWidth={columns.width}
              note={note}
              type={type}
              entry={type != null ? entryByPath.get(note.path) : undefined}
              picture={pictures.get(note.path)}
              resolveImageUrl={resolvePreviewImageUrl}
              recency={note.mtime > 0 ? formatRecencyLabel(note.mtime, settings) : '—'}
              onOpen={openNote}
            />
          ))}
        </div>
      ))}
      {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px w-px self-end" /> : null}
    </div>
  )
}

interface GridCardProps {
  /** The column width the card is laid out at, in px (part of its height key). */
  columnWidth: number
  note: NoteListEntry
  type: TagType | null | undefined
  entry: CollectionEntry | undefined
  picture: string | undefined
  resolveImageUrl: (src: string) => string | null
  recency: string
  onOpen: (path: string, event?: ModClickEvent) => void
}

/**
 * One card, as tall as the note it shows: the picture band (when the note
 * has one), the title, the live preview capped at {@link PREVIEW_MAX_HEIGHT}
 * and ending on a whole line, then the footer. Memoized so a thumbnail
 * arriving re-renders only its own card.
 */
const GridCard = memo(function GridCard({
  columnWidth,
  note,
  type,
  entry,
  picture,
  resolveImageUrl,
  recency,
  onOpen,
}: GridCardProps): ReactElement {
  const title = displayNoteTitle(note.title)
  const shownTags = note.tags.slice(0, MAX_FOOTER_TAGS)
  return (
    <div
      data-note-path={note.path}
      className={cn(
        GRID_CARD_CLASS,
        // Hidden until its preview's height is kept (card-preview-slot.tsx),
        // so the column never moves under the reader.
        'has-[[data-preview-pending]]:opacity-0',
      )}
    >
      <button
        type="button"
        aria-label={title}
        onClick={(event) => {
          onOpen(note.path, event)
        }}
        className={GRID_CARD_BUTTON_CLASS}
      />
      {picture !== undefined ? <NoteCardPicture src={picture} /> : null}
      <div className="flex min-w-0 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-sm font-semibold leading-snug text-text [overflow-wrap:anywhere]">
            {title}
          </h2>
          {note.isPinned ? (
            <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
          ) : null}
        </div>
        {type != null && entry !== undefined ? (
          <CardPropertyChips type={type} entry={entry} />
        ) : null}
        {note.snippet === '' ? null : (
          <CardPreviewSlot
            heightKey={`${note.path}\n${note.mtime}\n${columnWidth}`}
            className="mt-2.5 max-h-80"
          >
            {({ onSettled }) => (
              <NoteCardPreview
                path={note.path}
                mtime={note.mtime}
                snippet={note.snippet}
                shownTags={shownTags}
                resolveImageUrl={picture !== undefined ? noImageUrl : resolveImageUrl}
                nearMargin={PREPARE_MARGIN}
                onSettled={onSettled}
                className={cn(
                  'max-h-80',
                  // The picture band already shows the note's image.
                  picture !== undefined && 'kore-card-preview-pictured',
                )}
              />
            )}
          </CardPreviewSlot>
        )}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <TagChips tags={note.tags} max={MAX_FOOTER_TAGS} />
          <span className="ml-auto text-2xs text-text-muted">{recency}</span>
        </div>
      </div>
    </div>
  )
})
