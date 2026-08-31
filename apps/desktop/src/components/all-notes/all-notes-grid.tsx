import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { CollectionEntry, NoteListEntry, TagType } from '@reflect/core'
import { Pin } from '@/components/icons'
import { passivePreviewImageResolver } from '@/editor/preview-image-url'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { formatRecencyLabel } from '@/lib/dates'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useGraph } from '@/providers/graph-provider'
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

/**
 * The All Notes masonry view (Plan 28, Craft's register): the same notes as
 * the table, as live-preview cards — each note's actual rendered content at
 * the compact hover-card scale — flowing down CSS columns (cards keep their
 * natural height, columns fill left to right). A reading layout, not a
 * management one — cards open on click (⌘-click in a new window);
 * multi-select and its keyboard shortcuts stay with the table view. CSS
 * columns own the layout, so instead of the table's row virtualizer the grid
 * mounts in chunks: a sentinel below the cards reveals the next
 * {@link GRID_CHUNK} as it scrolls into reach — a many-thousand-note graph
 * never mounts every card at once (and each card upgrades from snippet to
 * preview only as it nears the viewport).
 */
export function AllNotesGrid({
  notes,
  tag,
  type,
  entries,
  onOpen,
}: AllNotesGridProps): ReactElement | null {
  const { settings } = useSettings()
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
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
  const { resolveImageUrl, resolveAssetOpenPath } = useAssetPersistence(generation)
  const resolvePreviewImageUrl = useMemo(
    () => passivePreviewImageResolver({ resolveImageUrl, resolveAssetOpenPath }),
    [resolveAssetOpenPath, resolveImageUrl],
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
      <p className="px-12 py-10 text-sm text-text-muted">
        {tag === null ? 'No notes yet.' : `No notes tagged #${tag}.`}
      </p>
    )
  }
  return (
    <div className="columns-[17rem] gap-5 px-12 pb-10 pt-2 [column-fill:balance]">
      {notes.slice(0, visibleCount).map((note) => {
        const entry = type != null ? entryByPath.get(note.path) : undefined
        return (
          <button
            key={note.path}
            data-note-path={note.path}
            type="button"
            onClick={(event) => {
              onOpen(note.path, event)
            }}
            // No shadow or hover lift: box shadows and transforms fragment
            // across CSS columns in WebKit, painting stray slivers at column
            // tops — a border tint carries the hover affordance instead. The
            // sunken surface (not the page's own `surface`) is what draws the
            // card's outline in dark themes, where the hairline border alone
            // all but vanished.
            className="group mb-5 block w-full break-inside-avoid rounded-2xl border border-border bg-surface-sunken p-5 text-left transition-colors duration-150 ease-swift hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 text-sm font-semibold leading-snug text-text">{note.title}</h2>
              {note.isPinned ? (
                <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
              ) : null}
            </div>
            {type != null && entry !== undefined ? (
              <CardPropertyChips type={type} entry={entry} />
            ) : null}
            <NoteCardPreview
              path={note.path}
              mtime={note.mtime}
              snippet={note.snippet}
              resolveImageUrl={resolvePreviewImageUrl}
            />
            <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
              {note.tags.slice(0, 3).map((noteTag) => (
                <span
                  key={noteTag}
                  className="rounded-full border border-border px-2 py-0.5 text-2xs font-medium text-text-secondary"
                >
                  {noteTag}
                </span>
              ))}
              <span className="ml-auto text-2xs text-text-muted">
                {note.mtime > 0 ? formatRecencyLabel(note.mtime, settings) : '—'}
              </span>
            </div>
          </button>
        )
      })}
      {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
    </div>
  )
}
