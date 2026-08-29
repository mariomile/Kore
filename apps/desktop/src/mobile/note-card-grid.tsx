import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Pin } from '@/components/icons'
import { formatRecencyLabel } from '@/lib/dates'
import { HighlightedText } from '@/mobile/highlighted-text'
import type { NoteRowModel } from '@/mobile/swipeable-note-row'
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
 * card at once.
 */
export function NoteCardGrid({ rows, onOpen }: NoteCardGridProps): ReactElement {
  const { settings } = useSettings()
  const [visibleCount, setVisibleCount] = useState(GRID_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMore = rows.length > visibleCount

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
        {rows.slice(0, visibleCount).map((row) => {
          const title = row.titleSegments.map((segment) => segment.text).join('')
          return (
            <div key={row.path} className="break-inside-avoid pb-3">
              <button
                type="button"
                aria-label={title}
                onClick={() => onOpen(row.path)}
                className="block w-full rounded-[10px] border border-border bg-surface p-3 text-left active:bg-surface-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 text-[13px] font-semibold leading-snug text-text">
                    <HighlightedText segments={row.titleSegments} />
                  </h2>
                  {row.isPinned ? (
                    <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
                  ) : null}
                </div>
                {row.snippet.length > 0 ? (
                  <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-text-secondary">
                    <HighlightedText segments={row.snippet} />
                  </p>
                ) : null}
                <div className="mt-3 text-2xs text-text-muted">
                  {row.mtime > 0 ? formatRecencyLabel(row.mtime, settings) : '—'}
                </div>
              </button>
            </div>
          )
        })}
        {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
      </div>
    </div>
  )
}
