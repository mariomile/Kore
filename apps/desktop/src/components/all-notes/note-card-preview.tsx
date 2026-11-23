import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  inlineEmbedSnapshots,
  splitFrontmatter,
  stripLeadingHeading,
  stripLeadingTagLine,
} from '@kore/core'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useAfterScroll } from '@/hooks/use-after-scroll'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useOverflowing } from '@/hooks/use-overflowing'
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

const NO_TAGS: readonly string[] = []

function truncateAtBlockBoundary(body: string): string {
  if (body.length <= PREVIEW_SOURCE_BUDGET + 200) {
    return body
  }
  const boundary = body.slice(0, PREVIEW_SOURCE_BUDGET + 200).indexOf('\n\n', PREVIEW_SOURCE_BUDGET)
  return body.slice(0, boundary === -1 ? PREVIEW_SOURCE_BUDGET + 200 : boundary)
}

interface NoteCardPreviewProps {
  path: string
  /** Busts the preview cache when the note changes on disk. */
  mtime: number
  /** The indexed plain-text snippet, shown until the real preview is read. */
  snippet: string
  /**
   * The tags the card's footer shows: a leading line of only these tags is
   * dropped from the preview so the card doesn't say `#meeting` twice.
   */
  shownTags?: readonly string[] | undefined
  resolveImageUrl: (src: string) => string | null
  /**
   * The box the rendered preview is clipped to. Defaults to filling a slot of
   * definite height (the desktop grid); a card of free height passes its own
   * cap (the phone grid's `max-h-…`).
   */
  clampClassName?: string
  /**
   * Hold the upgrade until scrolling rests (the phone grid): a markdown
   * render mid-flick costs the scroll its frames.
   */
  waitForScrollRest?: boolean
}

/** Fill the grid's definite preview slot, so the mask fades at the visible edge. */
const FILL_SLOT = 'h-full min-h-0'

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
  shownTags = NO_TAGS,
  resolveImageUrl,
  clampClassName = FILL_SLOT,
  waitForScrollRest = false,
}: NoteCardPreviewProps): ReactElement | null {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const { setRoot: setViewRoot, near } = useNearViewport(NEAR_VIEWPORT_MARGIN)
  const { setRoot: setClampRoot, overflowing } = useOverflowing()
  const rested = useAfterScroll(near && waitForScrollRest)
  const upgrade = waitForScrollRest ? rested : near

  // `mtime` in the key makes each entry immutable, so the app default
  // (staleTime Infinity) holds; a note edit reaches the card as a new key
  // via the refreshed list. Unrelated index updates must not reread cards.
  const { data: body } = useQuery({
    queryKey: ['note-card-preview', graph?.root, generation, path, mtime, shownTags.join('\n')],
    queryFn: async () => {
      if (generation === null) {
        return null
      }
      const source = await readExistingNoteSource(path, generation)
      // A passive card loads no remote embed, so a saved X/YouTube card
      // reads as its quoted words rather than its snapshot JSON.
      return truncateAtBlockBoundary(
        inlineEmbedSnapshots(
          stripLeadingTagLine(stripLeadingHeading(splitFrontmatter(source).body), shownTags),
        ),
      )
    },
    enabled: upgrade && generation !== null,
    // A grid's worth of bodies has no business outliving the view by long.
    gcTime: 60_000,
    retry: false,
  })

  const fallback =
    snippet === '' ? null : (
      <p className="line-clamp-4 text-xs leading-relaxed text-text-secondary">{snippet}</p>
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
        // The hover-card mask fades at the clipped edge instead of shearing
        // a line in half.
        'kore-hover-preview overflow-hidden text-xs text-text-secondary',
        clampClassName,
        overflowing && 'kore-hover-preview-overflowing',
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
