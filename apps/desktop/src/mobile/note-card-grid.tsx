import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { firstImageAssets } from '@kore/core'
import { Pin } from '@/components/icons'
import { passivePreviewImageResolver } from '@/editor/preview-image-url'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { formatRecencyLabel } from '@/lib/dates'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
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
 * preview cards flowing down CSS columns. A reading layout — cards open on
 * tap; pin and delete stay with the swipeable list. Chunks the mount the
 * same way desktop's All Notes grid does so a large graph never paints every
 * card at once. A note's first image tops its card: one indexed query per
 * mounted chunk names it, so no note body is read or rendered (desktop's
 * live-preview cards cost a markdown render each, too much for a phone's
 * scroll).
 */
export function NoteCardGrid({ rows, onOpen }: NoteCardGridProps): ReactElement {
  const { settings } = useSettings()
  const [visibleCount, setVisibleCount] = useState(GRID_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMore = rows.length > visibleCount
  const mountedRows = rows.slice(0, visibleCount)
  const firstImages = useFirstImages(mountedRows.map((row) => row.path))
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
      className="min-h-0 flex-1 overflow-y-auto"
      style={{
        paddingTop: 'var(--mobile-header-height, 0px)',
        paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
      }}
    >
      <div data-testid="all-notes-grid" className="columns-2 gap-3 px-4 py-4 [column-fill:balance]">
        {mountedRows.map((row) => (
          <NoteCard
            key={row.path}
            row={row}
            imageUrl={firstImages.get(row.path)}
            recency={row.mtime > 0 ? formatRecencyLabel(row.mtime, settings) : '—'}
            onOpen={openPath}
          />
        ))}
        {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
      </div>
    </div>
  )
}

interface NoteCardProps {
  row: NoteRowModel
  imageUrl: string | undefined
  recency: string
  onOpen: (path: string) => void
}

/** One grid card; memoized so a thumbnail arriving re-renders only its card. */
const NoteCard = memo(function NoteCard({
  row,
  imageUrl,
  recency,
  onOpen,
}: NoteCardProps): ReactElement {
  const title = row.titleSegments.map((segment) => segment.text).join('')
  return (
    <div className="break-inside-avoid pb-3">
      <button
        type="button"
        aria-label={title}
        onClick={() => onOpen(row.path)}
        className="block w-full rounded-xl border border-border bg-surface p-3 text-left active:bg-surface-hover"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-[13px] font-semibold leading-snug text-text">
            <HighlightedText segments={row.titleSegments} />
          </h2>
          {row.isPinned ? (
            <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
          ) : null}
        </div>
        {imageUrl !== undefined ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="mt-2 max-h-40 w-full rounded-lg object-cover"
          />
        ) : null}
        {row.snippet.length > 0 ? (
          <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-text-secondary">
            <HighlightedText segments={row.snippet} />
          </p>
        ) : null}
        <div className="mt-3 text-2xs text-text-muted">{recency}</div>
      </button>
    </div>
  )
})

const NO_IMAGES: ReadonlyMap<string, string> = new Map()

/**
 * Card thumbnail URLs by note path, for the cards on screen: the index names
 * each note's first raster image, and the passive-preview resolver turns it
 * into an asset URL (no network, no SVG). Index-scoped, so an edit that adds
 * or removes a photo refreshes the grid with every other index query.
 */
function useFirstImages(paths: readonly string[]): ReadonlyMap<string, string> {
  const { graph } = useGraph()
  const { resolveImageUrl, resolveAssetOpenPath } = useAssetPersistence(graph?.generation ?? null)
  const resolve = useMemo(
    () => passivePreviewImageResolver({ resolveImageUrl, resolveAssetOpenPath }),
    [resolveAssetOpenPath, resolveImageUrl],
  )
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
