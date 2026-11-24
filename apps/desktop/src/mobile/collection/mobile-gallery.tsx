import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { CollectionEntry, TagType } from '@kore/core'
import { CardPropertyChips } from '@/components/all-notes/card-property-chips'
import { useFirstImages } from '@/hooks/use-note-card-images'

/** How many cards mount at once; scrolling near the end reveals the next batch. */
const GALLERY_CHUNK = 60

interface MobileGalleryProps {
  entries: readonly CollectionEntry[]
  /** The schema the cards show (hidden fields left out). */
  type: TagType
  onOpen: (path: string) => void
}

/**
 * A type's gallery on a phone (Craft's and Notion's gallery, a moodboard
 * when the notes hold pictures): two columns of cards, each led by the
 * note's first image as its cover at the picture's own shape, then the
 * title and the fields the view shows. A note without a picture is a
 * compact text card, so a mixed collection still packs tightly. Covers come
 * from the index (one query per mounted batch), so no note body is read.
 */
export function MobileGallery({ entries, type, onOpen }: MobileGalleryProps): ReactElement {
  const [visibleCount, setVisibleCount] = useState(GALLERY_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMore = entries.length > visibleCount
  const mounted = entries.slice(0, visibleCount)
  const covers = useFirstImages(mounted.map((entry) => entry.path))
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const openPath = useCallback((path: string) => onOpenRef.current(path), [])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!hasMore || sentinel === null) {
      return
    }
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + GALLERY_CHUNK)
        }
      },
      { rootMargin: '800px' },
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
      <div data-testid="type-gallery" className="columns-2 gap-3 px-4 pt-3 pb-4">
        {mounted.map((entry) => (
          <GalleryCard
            key={entry.path}
            entry={entry}
            type={type}
            cover={covers.get(entry.path)}
            onOpen={openPath}
          />
        ))}
        {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
      </div>
    </div>
  )
}

interface GalleryCardProps {
  entry: CollectionEntry
  type: TagType
  cover: string | undefined
  onOpen: (path: string) => void
}

/** One card; memoized so a cover arriving re-renders only its own card. */
export const GalleryCard = memo(function GalleryCard({
  entry,
  type,
  cover,
  onOpen,
}: GalleryCardProps): ReactElement {
  return (
    <div className="break-inside-avoid pb-3">
      <button
        type="button"
        aria-label={entry.title}
        onClick={() => onOpen(entry.path)}
        className="block w-full overflow-hidden rounded-xl border border-border bg-surface text-left shadow-sm transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none"
      >
        {cover !== undefined ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="block max-h-72 min-h-24 w-full bg-surface-hover object-cover"
          />
        ) : null}
        <div className="flex flex-col gap-2 p-3">
          <span className="line-clamp-3 text-[14px] font-semibold leading-snug text-text">
            {entry.title}
          </span>
          <CardPropertyChips type={type} entry={entry} />
        </div>
      </button>
    </div>
  )
})
