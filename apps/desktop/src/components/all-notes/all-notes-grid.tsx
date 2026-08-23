import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { NoteListEntry } from '@reflect/core'
import { Pin } from '@/components/icons'
import { formatRecencyLabel } from '@/lib/dates'
import type { ModClickEvent } from '@/lib/windows/open-in-new-window'
import { useSettings } from '@/providers/settings-provider'

interface AllNotesGridProps {
  notes: readonly NoteListEntry[] | undefined
  /** Active tag filter — only used for the empty state's phrasing. */
  tag: string | null
  onOpen: (path: string, event?: ModClickEvent) => void
}

/** How many cards mount at once; scrolling near the end reveals the next batch. */
const GRID_CHUNK = 120

/**
 * The All Notes masonry view: the same notes as the table, as preview cards
 * flowing down CSS columns (cards keep their natural height, columns fill
 * left to right). A reading layout, not a management one — cards open on
 * click (⌘-click in a new window); multi-select and its keyboard shortcuts
 * stay with the table view. CSS columns own the layout, so instead of the
 * table's row virtualizer the grid mounts in chunks: a sentinel below the
 * cards reveals the next {@link GRID_CHUNK} as it scrolls into reach — a
 * many-thousand-note graph never mounts every card at once.
 */
export function AllNotesGrid({ notes, tag, onOpen }: AllNotesGridProps): ReactElement | null {
  const { settings } = useSettings()
  const [visibleCount, setVisibleCount] = useState(GRID_CHUNK)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasMore = notes !== undefined && notes.length > visibleCount

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
    <div className="columns-[15rem] gap-4 px-12 py-6 [column-fill:balance]">
      {notes.slice(0, visibleCount).map((note) => (
        <button
          key={note.path}
          data-note-path={note.path}
          type="button"
          onClick={(event) => {
            onOpen(note.path, event)
          }}
          className="group mb-4 block w-full break-inside-avoid rounded-[10px] border border-border bg-surface p-4 text-left shadow-sm transition-[box-shadow,transform] duration-150 ease-swift hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 text-[13px] font-semibold leading-snug text-text">
              {note.title}
            </h2>
            {note.isPinned ? (
              <Pin aria-label="Pinned" className="mt-0.5 size-3 shrink-0 text-text-muted" />
            ) : null}
          </div>
          {note.snippet !== '' ? (
            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-text-secondary">
              {note.snippet}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
      ))}
      {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
    </div>
  )
}
