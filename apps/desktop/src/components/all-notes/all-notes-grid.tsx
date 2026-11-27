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
  mergeFolderItems,
  type CollectionEntry,
  type LooseFile,
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
import { FileCard } from './folder-files'
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
  /**
   * A folder page's loose files, dealt among the notes in the page's sort
   * (already filtered like the notes).
   */
  files?: readonly LooseFile[]
  onOpen: (path: string, event?: ModClickEvent) => void
  /** Opens a loose file; required with `files`. */
  onOpenFile?: (path: string) => void
}

const NO_FILES: readonly LooseFile[] = []

const noteTitle = (note: NoteListEntry): string => note.title

/** Collection rows as the grid's note cards (a collection that isn't a tag page). */
export function collectionGridNotes(
  entries: readonly CollectionEntry[] | undefined,
): NoteListEntry[] | undefined {
  return entries?.map((entry) => ({
    path: entry.path,
    title: entry.title,
    snippet: '',
    tags: [],
    mtime: entry.mtime,
    isPinned: entry.isPinned,
  }))
}

/** How many cards mount at once; scrolling near the end reveals the next batch. */
const GRID_CHUNK = 120

/** A card's footer names this many of the note's tags. */
const MAX_FOOTER_TAGS = 3

/**
 * A column is at least this wide, in rem so a larger text size makes fewer,
 * wider columns instead of squeezing the cards: four columns in a wide
 * window, two in a narrow one. The gap between columns is the grid's own
 * (`gap-4`), read from its style.
 */
const COLUMN_MIN_WIDTH_REM = 13

/**
 * How much of a note's body a card shows: a few lines under a picture, which
 * already carries the card, and a short read for a note of text alone, so
 * one long note never fills a column. Part of the preview's height key.
 */
const PICTURED_PREVIEW_CAP = 'max-h-24'
const TEXT_PREVIEW_CAP = 'max-h-48'

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
  files = NO_FILES,
  onOpen,
  onOpenFile,
}: AllNotesGridProps): ReactElement | null {
  const { settings } = useSettings()
  const [visibleCount, setVisibleCount] = useState(GRID_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // A folder's files are documents of it like its notes: one grid, one order.
  const items = useMemo(
    () =>
      notes === undefined
        ? undefined
        : mergeFolderItems(notes, files, settings.allNotesSort, noteTitle),
    [notes, files, settings.allNotesSort],
  )
  const hasMore = items !== undefined && items.length > visibleCount
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
  const onOpenFileRef = useRef(onOpenFile)
  onOpenFileRef.current = onOpenFile
  const openFile = useCallback((path: string) => onOpenFileRef.current?.(path), [])
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
  const mountedItems = useMemo(() => items?.slice(0, visibleCount) ?? [], [items, visibleCount])
  // Each note's picture (its cover, else its first image), as a cached
  // card-sized thumbnail: one indexed query per mounted chunk.
  const pictures = useFirstImages(
    useMemo(
      () => mountedItems.flatMap((item) => (item.kind === 'note' ? [item.path] : [])),
      [mountedItems],
    ),
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
      const gap = Number.parseFloat(style.columnGap) || 0
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      const count = columnsThatFit(width, COLUMN_MIN_WIDTH_REM * rem, gap)
      return { count, width: Math.round((width - gap * (count - 1)) / count) }
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

  if (items === undefined) {
    return null
  }
  if (items.length === 0) {
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
      className="flex items-start gap-4 pb-10 pl-12 pr-7 pt-2"
    >
      {dealIntoColumns(mountedItems, columns.count).map((column, columnIndex) => (
        <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-4">
          {column.map((item) =>
            item.kind === 'file' ? (
              <FileCard key={item.path} file={item.file} onOpen={openFile} />
            ) : (
              <GridCard
                key={item.path}
                columnWidth={columns.width}
                note={item.note}
                type={type}
                entry={type != null ? entryByPath.get(item.path) : undefined}
                picture={pictures.get(item.path)}
                resolveImageUrl={resolvePreviewImageUrl}
                recency={item.note.mtime > 0 ? formatRecencyLabel(item.note.mtime, settings) : '—'}
                onOpen={openNote}
              />
            ),
          )}
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
 * has one), the title, the live preview capped by {@link TEXT_PREVIEW_CAP}
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
  const previewCap = picture !== undefined ? PICTURED_PREVIEW_CAP : TEXT_PREVIEW_CAP
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
      <div className="flex min-w-0 flex-col p-4">
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
            heightKey={`${note.path}\n${note.mtime}\n${columnWidth}\n${previewCap}`}
            className={cn('mt-2.5', previewCap)}
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
                  previewCap,
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
