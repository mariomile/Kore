import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { splitFrontmatter, stripLeadingHeading } from '@reflect/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useOverflowing } from '@/hooks/use-overflowing'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { useGraph } from '@/providers/graph-provider'
import { cn } from '@/lib/utils'

/**
 * How early a card upgrades from snippet to preview. The grid mounts cards
 * in chunks of 120, but reading and rendering 120 markdown previews at once
 * would still stall the first paint — each card upgrades only as it comes
 * within reach.
 */
const NEAR_VIEWPORT_MARGIN = '400px'

/**
 * The card clamps at ~10 lines, so parsing a long note past the first block
 * boundary beyond this many characters buys nothing — it only grows the
 * parse, the DOM, and the cached string.
 */
const PREVIEW_SOURCE_BUDGET = 1200

function truncateAtBlockBoundary(body: string): string {
  if (body.length <= PREVIEW_SOURCE_BUDGET + 200) {
    return body
  }
  const boundary = body.indexOf('\n\n', PREVIEW_SOURCE_BUDGET)
  return body.slice(0, boundary === -1 ? PREVIEW_SOURCE_BUDGET + 200 : boundary)
}

interface NoteCardPreviewProps {
  path: string
  /** Busts the preview cache when the note changes on disk. */
  mtime: number
  /** The indexed plain-text snippet, shown until the real preview is read. */
  snippet: string
  resolveImageUrl: (src: string) => string | null
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
  snippet,
  resolveImageUrl,
}: NoteCardPreviewProps): ReactElement | null {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const { setRoot: setViewRoot, near } = useNearViewport(NEAR_VIEWPORT_MARGIN)
  const { setRoot: setClampRoot, overflowing } = useOverflowing()

  // `mtime` in the key makes each entry immutable, so the app default
  // (staleTime Infinity) holds; a note edit reaches the card as a new key
  // via the refreshed list, and index invalidation can drop old entries.
  const { data: body } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'note-card-preview', path, mtime],
    queryFn: async () => {
      if (generation === null) {
        return null
      }
      const source = await readExistingNoteSource(path, generation)
      return truncateAtBlockBoundary(stripLeadingHeading(splitFrontmatter(source).body))
    },
    enabled: near && generation !== null,
    // A grid's worth of bodies has no business outliving the view by long.
    gcTime: 60_000,
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
        overflowing && 'app-card-fade',
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
