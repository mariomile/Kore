import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { firstImageAssets } from '@kore/core'
import { NoteCardPreview } from '@/components/all-notes/note-card-preview'
import { Pin } from '@/components/icons'
import { passivePreviewImageResolver } from '@/editor/preview-image-url'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { NEAR_VIEWPORT_SCROLLER } from '@/hooks/use-near-viewport'
import { formatRecencyLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { CardPreviewSlot } from '@/mobile/card-preview-slot'
import { HighlightedText } from '@/mobile/highlighted-text'
import type { NoteRowModel } from '@/mobile/swipeable-note-row'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

interface NoteCardGridProps {
  rows: NoteRowModel[]
  onOpen: (path: string) => void
}

/** How many cards mount at once; scrolling near the end reveals the next batch. */
const GRID_CHUNK = 120

/**
 * The All tab's masonry card grid: the same rows as {@link NoteRowList}, as
 * preview cards dealt row by row into two columns. A reading layout — cards open on
 * tap; pin and delete stay with the swipeable list. Chunks the mount the
 * same way desktop's All Notes grid does so a large graph never paints every
 * card at once. A note's first image tops its card: one indexed query per
 * mounted chunk names it. The body is desktop's live preview (a table is a
 * table, a tag a chip), read and rendered only once scrolling rests; the
 * indexed snippet stands in until then. A card on screen never changes
 * height (see `card-preview-slot.tsx`), so the grid never moves under the
 * reader.
 */
export function NoteCardGrid({ rows, onOpen }: NoteCardGridProps): ReactElement {
  const { settings } = useSettings()
  const [visibleCount, setVisibleCount] = useState(GRID_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMore = rows.length > visibleCount
  const mountedRows = rows.slice(0, visibleCount)
  const firstImages = useFirstImages(mountedRows.map((row) => row.path))
  const resolveImageUrl = usePassiveImageResolver()
  // The screen passes a fresh onOpen each render; a stable one lets the
  // memoized cards skip re-rendering when only the thumbnails arrive.
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const openPath = useCallback((path: string) => onOpenRef.current(path), [])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!hasMore || sentinel === null) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + GRID_CHUNK)
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, visibleCount])

  return (
    <div
      {...{ [NEAR_VIEWPORT_SCROLLER]: '' }}
      className="min-h-0 flex-1 overflow-y-auto"
      style={{
        paddingTop: 'var(--mobile-header-height, 0px)',
        paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
      }}
    >
      <div data-testid="all-notes-grid" className="flex items-start gap-3 px-4 py-4">
        {splitIntoColumns(mountedRows).map((column, columnIndex) => (
          <div key={columnIndex} className="flex min-w-0 flex-1 flex-col">
            {column.map((row) => (
              <NoteCard
                key={row.path}
                row={row}
                imageUrl={firstImages.get(row.path)}
                resolveImageUrl={resolveImageUrl}
                recency={row.mtime > 0 ? formatRecencyLabel(row.mtime, settings) : '—'}
                onOpen={openPath}
              />
            ))}
          </div>
        ))}
      </div>
      {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
    </div>
  )
}

interface NoteCardProps {
  row: NoteRowModel
  imageUrl: string | undefined
  resolveImageUrl: (src: string) => string | null
  recency: string
  onOpen: (path: string) => void
}

/**
 * How far from the screen a card's preview is prepared: about a screen and
 * a half, so an ordinary flick lands on cards that already have their own
 * height (see `card-preview-slot.tsx`).
 */
const PREPARE_MARGIN = '1200px'

/**
 * How much of a note a card half a phone wide can show: about eight lines
 * of some twenty-five characters, with room for markup.
 */
const SOURCE_BUDGET = 400

/** The grid's column count: two cards side by side on a phone. */
const GRID_COLUMNS = 2

/**
 * Deal the rows across the columns left to right, row by row, so the grid
 * reads in the list's order: the newest note top left, the second newest top
 * right. CSS columns would fill the whole left column first, splitting a
 * recency sort into "left half newer than right half".
 */
function splitIntoColumns<T>(rows: readonly T[]): T[][] {
  const columns: T[][] = Array.from({ length: GRID_COLUMNS }, () => [])
  for (const [index, row] of rows.entries()) {
    columns[index % GRID_COLUMNS]?.push(row)
  }
  return columns
}

/** One grid card; memoized so a thumbnail arriving re-renders only its card. */
const NoteCard = memo(function NoteCard({
  row,
  imageUrl,
  resolveImageUrl,
  recency,
  onOpen,
}: NoteCardProps): ReactElement {
  const title = row.titleSegments.map((segment) => segment.text).join('')
  // A search hit shows where it matched; otherwise the card shows the note.
  const isSearchHit = row.snippet.some((segment) => segment.highlighted)
  const snippet = row.snippet.map((segment) => segment.text).join('')
  const [settled, setSettled] = useState(false)
  const markSettled = useCallback(() => setSettled(true), [])
  return (
    <div className="pb-3">
      {/* The button covers the card instead of wrapping it: WebKit does not
          clip a box of definite height inside a <button>, and the preview
          keeps one. */}
      <div
        data-note-path={row.path}
        className={cn(
          'relative rounded-xl border border-border bg-surface p-3 has-[button:active]:bg-surface-hover',
          // Hidden until its preview's height is kept (card-preview-slot.tsx).
          'transition-opacity duration-100 has-[[data-preview-pending]]:opacity-0',
        )}
      >
        <button
          type="button"
          aria-label={title}
          onClick={() => onOpen(row.path)}
          className="absolute inset-0 z-[1] rounded-xl"
        />
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-3 min-w-0 text-[13px] font-semibold leading-snug text-text [overflow-wrap:anywhere]">
            <HighlightedText segments={row.titleSegments} />
          </h2>
          {row.isPinned ? (
            <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
          ) : null}
        </div>
        {row.propertyLine !== undefined ? (
          <p className="mt-1.5 line-clamp-2 text-xs font-medium text-text-secondary">
            {row.propertyLine}
          </p>
        ) : null}
        {imageUrl !== undefined ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="mt-2 max-h-40 w-full rounded-lg object-cover"
          />
        ) : null}
        {isSearchHit ? (
          <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
            <HighlightedText segments={row.snippet} />
          </p>
        ) : snippet === '' ? null : (
          <CardPreviewSlot
            heightKey={`${row.path}\n${row.mtime}`}
            settled={settled}
            className="mt-2 max-h-44"
          >
            {(arrived) => (
              <NoteCardPreview
                path={row.path}
                mtime={row.mtime}
                snippet={snippet}
                resolveImageUrl={resolveImageUrl}
                waitForScrollRest
                nearMargin={PREPARE_MARGIN}
                sourceBudget={SOURCE_BUDGET}
                urgent={arrived}
                onSettled={markSettled}
                className={cn(
                  'kore-card-preview-compact max-h-44',
                  // The card's own thumbnail already shows the note's image.
                  imageUrl !== undefined && '[&_img]:hidden',
                )}
              />
            )}
          </CardPreviewSlot>
        )}
        <div className="mt-3 text-2xs text-text-muted">{recency}</div>
      </div>
    </div>
  )
})

const NO_IMAGES: ReadonlyMap<string, string> = new Map()

/** A vault image source as a URL a passive card may load: no network, no SVG. */
function usePassiveImageResolver(): (src: string) => string | null {
  const { graph } = useGraph()
  const { resolveImageUrl, resolveAssetOpenPath } = useAssetPersistence(graph?.generation ?? null)
  return useMemo(
    () => passivePreviewImageResolver({ resolveImageUrl, resolveAssetOpenPath }),
    [resolveAssetOpenPath, resolveImageUrl],
  )
}

/**
 * Card thumbnail URLs by note path, for the cards on screen: the index names
 * each note's first raster image, and the passive-preview resolver turns it
 * into an asset URL (no network, no SVG). Index-scoped, so an edit that adds
 * or removes a photo refreshes the grid with every other index query.
 */
export function useFirstImages(paths: readonly string[]): ReadonlyMap<string, string> {
  const { graph } = useGraph()
  const resolve = usePassiveImageResolver()
  const { data } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'mobile-card-images', paths],
    queryFn: () => firstImageAssets(paths),
    enabled: graph !== null && graph !== undefined && paths.length > 0,
  })
  return useMemo(() => {
    if (data === undefined) {
      return NO_IMAGES
    }
    const urls = new Map<string, string>()
    for (const [path, asset] of data) {
      const url = resolve(asset)
      if (url !== null) {
        urls.set(path, url)
      }
    }
    return urls
  }, [data, resolve])
}
