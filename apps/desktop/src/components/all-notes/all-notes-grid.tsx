import { cn } from '@/lib/utils'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
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
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'
import { CardPropertyChips } from './card-property-chips'
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

/**
 * The All Notes masonry view (Plan 28, Craft's register): the same notes as
 * the table, as live-preview cards — each note's actual rendered content at
 * the compact hover-card scale. On a column grid (`auto-fill` so leftover
 * width stays on the right instead of opening a hole between cards;
 * `masonry` rows where the engine supports them). Engines without masonry
 * stretch every card to the row's tallest neighbor, so a body-less note
 * fills the cell instead of leaving a hole. A reading layout, not a
 * management one: cards open on click (⌘-click in the pane beside this one);
 * multi-select and its keyboard shortcuts stay with the table view. Instead
 * of the table's row virtualizer the grid mounts in chunks: a sentinel
 * below the cards reveals the next {@link GRID_CHUNK} as it scrolls into
 * reach — a many-thousand-note graph never mounts every card at once (and
 * each card upgrades from snippet to preview only as it nears the viewport).
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
      data-testid="all-notes-grid"
      className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-5 pb-10 pl-12 pr-7 pt-2 [grid-template-rows:masonry]"
    >
      {mountedNotes.map((note) => {
        const entry = type != null ? entryByPath.get(note.path) : undefined
        const shownTags = note.tags.slice(0, MAX_FOOTER_TAGS)
        const picture = pictures.get(note.path)
        return (
          <button
            key={note.path}
            data-note-path={note.path}
            type="button"
            onClick={(event) => {
              onOpen(note.path, event)
            }}
            // No shadow or hover lift: a border tint carries the hover
            // affordance. The sunken surface (not the page's own `surface`)
            // is what draws the card's outline in dark themes, where the
            // hairline border alone all but vanished. `h-full` + column flex
            // stretch a body-less card to the row so the title and footer
            // do not sit on a stub with a hole beneath it. The preview is
            // absolutely filled in the leftover slot so overflow clips in a
            // box of definite height (in-flow max-height was ignored inside
            // the <button> on WebKit) — above the footer, never through it.
            // Clip on this inner shell, not the button: that would eat the
            // focus ring, and WebKit ignores overflow on <button> itself.
            // A picture card adds its 10rem band on top of the text card's
            // 16rem, so the picture never eats the note's own words.
            className={cn(
              'group flex h-full w-full flex-col rounded-2xl border border-border bg-surface-sunken p-0 text-left transition-colors duration-150 ease-swift hover:border-border-strong',
              picture !== undefined ? 'min-h-[26rem]' : 'min-h-64',
            )}
          >
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl">
              {picture !== undefined ? (
                <img
                  src={picture}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  data-testid="note-card-picture"
                  className="h-40 w-full shrink-0 bg-surface-hover object-cover"
                />
              ) : null}
              <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col p-5">
                <div className="flex shrink-0 items-start justify-between gap-2">
                  <h2 className="min-w-0 text-sm font-semibold leading-snug text-text [overflow-wrap:anywhere]">
                    {displayNoteTitle(note.title)}
                  </h2>
                  {note.isPinned ? (
                    <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
                  ) : null}
                </div>
                {type != null && entry !== undefined ? (
                  <CardPropertyChips type={type} entry={entry} />
                ) : null}
                <div className="relative mt-2.5 min-h-0 min-w-0 flex-1">
                  <div
                    data-testid="note-card-preview-slot"
                    className="absolute inset-0 overflow-hidden"
                  >
                    <NoteCardPreview
                      path={note.path}
                      mtime={note.mtime}
                      snippet={note.snippet}
                      shownTags={shownTags}
                      resolveImageUrl={picture !== undefined ? noImageUrl : resolvePreviewImageUrl}
                      // The picture band already shows the note's image.
                      className={picture !== undefined ? 'kore-card-preview-pictured' : ''}
                    />
                  </div>
                </div>
                <div className="relative z-[1] mt-auto flex shrink-0 flex-wrap items-center gap-1.5 pt-3.5">
                  <TagChips tags={note.tags} max={MAX_FOOTER_TAGS} />
                  <span className="ml-auto text-2xs text-text-muted">
                    {note.mtime > 0 ? formatRecencyLabel(note.mtime, settings) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </button>
        )
      })}
      {hasMore ? <div ref={sentinelRef} aria-hidden className="col-span-full h-px" /> : null}
    </div>
  )
}
