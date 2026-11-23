import { useEffect, type ReactElement } from 'react'
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

/** How far past the budget a block may run before it is cut mid-block. */
const BLOCK_OVERRUN = 200

const NO_TAGS: readonly string[] = []

function truncateAtBlockBoundary(body: string, budget: number): string {
  if (body.length <= budget + BLOCK_OVERRUN) {
    return body
  }
  const boundary = body.slice(0, budget + BLOCK_OVERRUN).indexOf('\n\n', budget)
  return body.slice(0, boundary === -1 ? budget + BLOCK_OVERRUN : boundary)
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
  /** Extra classes for the rendered preview's box (it fills its slot). */
  className?: string
  /**
   * Hold the upgrade until scrolling rests (the phone grid): a markdown
   * render mid-flick costs the scroll its frames.
   */
  waitForScrollRest?: boolean
  /** With `waitForScrollRest`: the card is on screen, so it upgrades before the others. */
  urgent?: boolean
  /** How much of the note's source a card this size can show; the default suits ~10 lines. */
  sourceBudget?: number
  /** How early the card upgrades; the default suits a grid of equal cards. */
  nearMargin?: string
  /** Called once the card shows all it will: the preview, or the snippet for good. */
  onSettled?: () => void
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
  shownTags = NO_TAGS,
  resolveImageUrl,
  className,
  waitForScrollRest = false,
  urgent = false,
  sourceBudget = PREVIEW_SOURCE_BUDGET,
  nearMargin = NEAR_VIEWPORT_MARGIN,
  onSettled,
}: NoteCardPreviewProps): ReactElement | null {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const { setRoot: setViewRoot, near } = useNearViewport(nearMargin)
  const { setRoot: setClampRoot, overflowing, overflowingX } = useOverflowing()
  const rested = useAfterScroll(near && waitForScrollRest, urgent)
  const upgrade = waitForScrollRest ? rested : near

  // `mtime` in the key makes each entry immutable, so the app default
  // (staleTime Infinity) holds; a note edit reaches the card as a new key
  // via the refreshed list. Unrelated index updates must not reread cards.
  const { data: body, isFetched } = useQuery({
    queryKey: [
      'note-card-preview',
      graph?.root,
      generation,
      path,
      mtime,
      shownTags.join('\n'),
      sourceBudget,
    ],
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
        sourceBudget,
      )
    },
    enabled: upgrade && generation !== null,
    // A grid's worth of bodies has no business outliving the view by long.
    gcTime: 60_000,
    retry: false,
  })

  const settled = upgrade && isFetched
  useEffect(() => {
    if (settled) {
      onSettled?.()
    }
  }, [settled, onSettled])

  const fallback =
    snippet === '' ? null : (
      <p className="line-clamp-4 text-xs leading-relaxed text-text-secondary">{snippet}</p>
    )

  // A body still cached from an earlier mount waits its turn too: a grid
  // coming back must not render a whole chunk of previews in one frame.
  if (!upgrade || body === undefined || body === null) {
    return <div ref={setViewRoot}>{fallback}</div>
  }
  if (body.trim() === '') {
    return null
  }
  return (
    <div
      ref={setClampRoot}
      className={cn(
        // Fill the card's definite preview slot so the hover-card mask
        // fades at the visible edge instead of shearing a line in half.
        'kore-hover-preview h-full min-h-0 overflow-hidden text-xs text-text-secondary',
        className,
        overflowing && 'kore-hover-preview-overflowing',
        overflowingX && 'kore-hover-preview-overflowing-x',
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
