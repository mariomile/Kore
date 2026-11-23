import { useCallback, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { cn } from '@/lib/utils'

/**
 * The height of a phone grid card's preview (mobile/note-card-grid.tsx).
 *
 * A card is as tall as the note it shows, and the note is read only near the
 * screen, so a card's height is not known when it mounts. The rule that keeps
 * the grid still under the reader: a preview takes whatever height its
 * content has while its card is away from the screen, and keeps the height
 * it has when the card arrives there. Whatever comes later fits inside (a
 * longer body fades out). Heights are remembered, so a grid coming back lays
 * out as it was.
 *
 * A card that is scrolled to keeps its height at once. Cards that appear on
 * the screen (the grid opening, a filter changing) have no "before" to
 * settle in: they stay hidden for the few frames their previews
 * take and show together, settled. A card is visible exactly when its height
 * is kept; `PENDING` marks the ones that are not, for the card to hide by.
 */

/** On the slot while its height is still open; the card hides while it has one. */
export const PENDING = 'data-preview-pending'

/**
 * "Arriving": a little outside the screen, so a card is settled and visible
 * before a flick brings it in.
 */
const ARRIVING = '160px'

/** Longest the cards that appeared on screen wait for their previews before showing as they are. */
const SETTLE_TIMEOUT_MS = 400

/** Kept preview heights in px, by note and version. */
const heights = new Map<string, number>()
const HEIGHTS_LIMIT = 4000

function remember(key: string, height: number): void {
  if (heights.size >= HEIGHTS_LIMIT) {
    heights.clear()
  }
  heights.set(key, height)
}

/**
 * The cards that appeared on screen and wait for their previews. They show together: one shown
 * early would be pushed down when a card above it got its preview.
 */
const waiting = new Set<() => void>()
let timeout: number | null = null

function showWaiting(): void {
  if (timeout !== null) {
    window.clearTimeout(timeout)
    timeout = null
  }
  const keeps = [...waiting]
  waiting.clear()
  for (const keep of keeps) {
    keep()
  }
}

/** Wait with the others; the returned release is for a card whose preview arrived. */
function wait(keep: () => void): () => void {
  if (waiting.size === 0) {
    timeout = window.setTimeout(showWaiting, SETTLE_TIMEOUT_MS)
  }
  waiting.add(keep)
  return () => {
    if (waiting.delete(keep) && waiting.size === 0) {
      showWaiting()
    }
  }
}

interface CardPreviewSlotProps {
  /** Names the note and its version: a kept height is for exactly this content. */
  heightKey: string
  /** Whether the preview inside has its final content. */
  settled: boolean
  className?: string
  /** The preview, told whether its card has arrived at the screen. */
  children: (arrived: boolean) => ReactNode
}

/** The box a card's preview lives in; see the rule at the top of this file. */
export function CardPreviewSlot({
  heightKey,
  settled,
  className,
  children,
}: CardPreviewSlotProps): ReactElement {
  const {
    setRoot: setArrivingRoot,
    near: arrived,
    approached: scrolledTo,
  } = useNearViewport(ARRIVING)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      boxRef.current = node
      setArrivingRoot(node)
    },
    [setArrivingRoot],
  )

  // The height kept for this mount, and the note version it was kept for.
  const keptFor = useRef<string | null>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!arrived || box === null || heights.has(heightKey) || keptFor.current === heightKey) {
      return
    }
    const keep = (): void => {
      // Unrounded: a rounded height would nudge the card by a fraction of a pixel.
      const { height } = box.getBoundingClientRect()
      keptFor.current = heightKey
      // A height kept before the preview arrived is the snippet's: it holds
      // while this card is mounted, and the next visit measures again.
      if (settled) {
        remember(heightKey, height)
      }
      // Straight to the element: a render per card would cost the scroll
      // that brought the card here. A later render leaves both alone.
      box.style.height = `${height}px`
      box.removeAttribute(PENDING)
    }
    if (settled || scrolledTo) {
      keep()
      return
    }
    return wait(keep)
  }, [arrived, scrolledTo, settled, heightKey])

  const height = heights.get(heightKey)
  return (
    <div
      ref={setRoot}
      className={cn('overflow-hidden', className)}
      style={height === undefined ? undefined : { height }}
      {...{ [PENDING]: height === undefined ? '' : undefined }}
    >
      {children(arrived)}
    </div>
  )
}
