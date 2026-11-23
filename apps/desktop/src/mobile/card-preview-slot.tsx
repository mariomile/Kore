import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
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
 * is kept; `data-preview-pending` marks the slots that are not, for the card
 * to hide by.
 */

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

/** A card that appeared on screen, waiting to show with the others. */
interface Waiter {
  /** Fix the card's height as it is and show it. */
  keep: () => void
  /** Its preview has arrived. */
  ready: boolean
}

/**
 * The cards that appeared on screen and wait for their previews. They show
 * together, once every one is ready: one shown early would be pushed down
 * when a card above it got its preview.
 */
const waiting = new Set<Waiter>()
let timeout: number | null = null
let checking = false

function showWaiting(): void {
  if (timeout !== null) {
    window.clearTimeout(timeout)
    timeout = null
  }
  const waiters = [...waiting]
  waiting.clear()
  for (const waiter of waiters) {
    waiter.keep()
  }
}

/**
 * Show the cards if all are ready. Checked after the current render's
 * effects, so cards that join or get ready in one commit count together.
 */
function checkWaiting(): void {
  if (checking) {
    return
  }
  checking = true
  queueMicrotask(() => {
    checking = false
    if ([...waiting].every((waiter) => waiter.ready)) {
      showWaiting()
    }
  })
}

/** Wait with the others; the returned function leaves without showing (the card is gone). */
function join(waiter: Waiter): () => void {
  if (waiting.size === 0) {
    timeout = window.setTimeout(showWaiting, SETTLE_TIMEOUT_MS)
  }
  waiting.add(waiter)
  checkWaiting()
  return () => {
    if (waiting.delete(waiter)) {
      checkWaiting()
    }
  }
}

/** What the slot tells the preview inside it, and needs to hear back. */
interface SlotState {
  /** The card has arrived at the screen: its preview goes before the others. */
  arrived: boolean
  /** For the preview to call once it shows all it will. */
  onSettled: () => void
}

interface CardPreviewSlotProps {
  /** Names the note and its version: a kept height is for exactly this content. */
  heightKey: string
  className?: string
  children: (slot: SlotState) => ReactNode
}

/** The box a card's preview lives in; see the rule at the top of this file. */
export function CardPreviewSlot({
  heightKey,
  className,
  children,
}: CardPreviewSlotProps): ReactElement {
  // Settled is per note version: an edited note's preview has to arrive again.
  const [settledKey, setSettledKey] = useState<string | null>(null)
  const settled = settledKey === heightKey
  const onSettled = useCallback(() => setSettledKey(heightKey), [heightKey])
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

  // The note version this mount has kept a height for, and its place among
  // the waiting cards while it has none.
  const keptFor = useRef<string | null>(null)
  const waiter = useRef<Waiter | null>(null)
  const settledRef = useRef(settled)

  useLayoutEffect(() => {
    settledRef.current = settled
    if (settled && waiter.current !== null) {
      waiter.current.ready = true
      checkWaiting()
    }
  }, [settled])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!arrived || box === null || heights.has(heightKey) || keptFor.current === heightKey) {
      return
    }
    const keep = (): void => {
      // Unrounded: a rounded height would nudge the card by a fraction of a pixel.
      const { height } = box.getBoundingClientRect()
      // A height kept before the preview arrived is the snippet's: it holds
      // while this card is mounted, and the next visit measures again.
      if (settledRef.current) {
        remember(heightKey, height)
      }
      keptFor.current = heightKey
      // Straight to the element: a render per card would cost the scroll
      // that brought the card here. A later render leaves both alone.
      box.style.height = `${height}px`
      box.removeAttribute('data-preview-pending')
    }
    // Scrolled to: the reader is about to see it, as it is. A new version
    // of a card already here appears in place, like the rest.
    if (scrolledTo && keptFor.current === null) {
      keep()
      return
    }
    const self: Waiter = { keep, ready: settledRef.current }
    waiter.current = self
    const leave = join(self)
    return () => {
      waiter.current = null
      leave()
    }
  }, [arrived, scrolledTo, heightKey])

  const height = heights.get(heightKey)
  return (
    <div
      ref={setRoot}
      className={cn('overflow-hidden', className)}
      style={height === undefined ? undefined : { height }}
      data-preview-pending={height === undefined ? '' : undefined}
    >
      {children({ arrived, onSettled })}
    </div>
  )
}
