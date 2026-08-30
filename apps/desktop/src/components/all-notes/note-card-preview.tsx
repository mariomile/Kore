import { useEffect, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { splitFrontmatter } from '@reflect/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useOverflowing } from '@/hooks/use-overflowing'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { cn } from '@/lib/utils'

interface NoteCardPreviewProps {
  path: string
  /** Busts the preview cache when the note changes on disk. */
  mtime: number
  generation: number | null
  graphRoot: string | null
  /** The indexed plain-text snippet, shown until the real preview is read. */
  snippet: string
  resolveImageUrl: (src: string) => string | null
}

/**
 * Watches when the card first approaches the viewport, once. The grid mounts
 * cards in chunks of 120, but reading and rendering 120 markdown previews at
 * once would still stall the first paint — each card upgrades from its
 * indexed snippet to the real preview only as it comes within reach.
 */
function useNearViewport(margin: string): {
  setRoot: (root: HTMLDivElement | null) => void
  near: boolean
} {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near || root === null || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
        }
      },
      { rootMargin: margin },
    )
    observer.observe(root)
    return () => {
      observer.disconnect()
    }
  }, [near, root, margin])

  return { setRoot, near }
}

/**
 * The card body of the All Notes grid (Plan 28, Craft's register): the note's
 * actual content — checkboxes, images, tables, chips — rendered read-only at
 * the compact hover-card scale, fading out at the clamp edge, instead of a
 * plain-text snippet. The leading H1 is dropped (the card's own title row
 * already says it); the snippet stands in until the note is read, and stays
 * if the read fails (a trashed note racing the list, an evicted file).
 */
export function NoteCardPreview({
  path,
  mtime,
  generation,
  graphRoot,
  snippet,
  resolveImageUrl,
}: NoteCardPreviewProps): ReactElement | null {
  const { setRoot: setViewRoot, near } = useNearViewport('400px')
  const { setRoot: setClampRoot, overflowing } = useOverflowing()

  const { data: body } = useQuery({
    queryKey: ['note-card-preview', graphRoot, path, mtime],
    queryFn: async () => {
      if (generation === null) {
        return null
      }
      const source = await readExistingNoteSource(path, generation)
      // The frontmatter is schema, the H1 repeats the title row — the card
      // shows what the note says, not what it is called.
      return splitFrontmatter(source).body.replace(/^\s*#\s[^\n]*\n?/, '')
    },
    enabled: near && generation !== null,
    staleTime: 30_000,
    retry: false,
  })

  const fallback =
    snippet === '' ? null : (
      <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-text-secondary">{snippet}</p>
    )

  if (body === undefined || body === null) {
    return <div ref={setViewRoot}>{fallback}</div>
  }
  if (body.trim() === '') {
    return null
  }
  return (
    <div
      ref={setClampRoot}
      className={cn(
        'reflect-hover-preview mt-2.5 max-h-56 overflow-hidden text-xs text-text-secondary',
        overflowing && 'reflect-hover-preview-overflowing',
      )}
    >
      <div>
        <MarkdownPreview
          content={body}
          resolveImageUrl={resolveImageUrl}
          interactive={false}
          className="text-xs leading-relaxed"
        />
      </div>
    </div>
  )
}
