/**
 * The motions of a block drag ({@link startBlockDrag} in block-drag.ts): how
 * a lifted block looks, how blocks slide aside, and how everything comes to
 * rest. Every one is a Web Animation, never an inline style, which
 * ProseMirror would read as an edit and redraw.
 */

const SETTLE_MS = 220
const SETTLE_EASING = 'cubic-bezier(0.2, 0.9, 0.3, 1)'
/** How long the blocks around take to part, and the lifted ones to change level. */
const PART_MS = 200
/** A lifted block: over its neighbours, with a shadow under it. */
export const LIFTED: Keyframe = { filter: 'drop-shadow(0 10px 14px rgb(0 0 0 / 0.2))', zIndex: 5 }
const RESTING: Keyframe = { filter: 'drop-shadow(0 0 0 rgb(0 0 0 / 0))', zIndex: 5 }
/** A landing this near where a block already shows needs no settling. */
const SETTLED_PX = 0.5

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Where something shows on screen. */
export interface Place {
  top: number
  left: number
}

export function placeOf(element: HTMLElement | undefined | null): Place | null {
  const bounds = element?.getBoundingClientRect()
  return bounds === undefined ? null : { top: bounds.top, left: bounds.left }
}

/**
 * Slide `elements` from where their first one showed (`from`) to where they
 * now sit, coming to rest from `rest`.
 */
export function settle(
  elements: readonly HTMLElement[],
  from: Place | null,
  rest?: { from: Keyframe; to: Keyframe },
): void {
  const to = placeOf(elements[0])
  if (from === null || to === null || reducedMotion()) return
  const x = from.left - to.left
  const y = from.top - to.top
  if (rest === undefined && Math.abs(x) < SETTLED_PX && Math.abs(y) < SETTLED_PX) return
  for (const element of elements) {
    element.animate(
      [
        { transform: `translate(${x}px, ${y}px)`, ...rest?.from },
        { transform: 'translate(0, 0)', ...rest?.to },
      ],
      { duration: SETTLE_MS, easing: SETTLE_EASING },
    )
  }
}

export const LANDING = { from: LIFTED, to: RESTING }

/** A swiped block let go `x` pixels to the side: it springs back into line. */
export function slideBack(element: HTMLElement, x: number): void {
  if (reducedMotion() || Math.abs(x) < SETTLED_PX || typeof element.animate !== 'function') return
  element.animate([{ transform: `translateX(${x}px)` }, { transform: 'translateX(0)' }], {
    duration: SETTLE_MS,
    easing: SETTLE_EASING,
  })
}

/** Elements held at an offset along one axis, sliding to each new one. */
export interface Slide {
  /** Slide on to `offset` from wherever the elements are now. */
  to: (offset: number) => void
  /** Slide back to no offset and let go of the elements. */
  rest: () => void
  /** Let go of the elements where they stand. */
  stop: () => void
}

export function createSlide(
  elements: readonly HTMLElement[],
  axis: 'X' | 'Y',
  composite: CompositeOperation = 'replace',
): Slide {
  let from = 0
  let target = 0
  let running: Animation[] = []
  const stop = (): void => {
    for (const animation of running) animation.cancel()
    running = []
  }
  const to = (offset: number): void => {
    if (offset === target) return
    // The effect's easing is in its progress, so this is where they show now.
    const progress = running[0]?.effect?.getComputedTiming().progress ?? 1
    from += (target - from) * progress
    target = offset
    stop()
    running = elements.map((element) =>
      element.animate(
        [
          { transform: `translate${axis}(${from}px)` },
          { transform: `translate${axis}(${target}px)` },
        ],
        {
          duration: reducedMotion() ? 0 : PART_MS,
          easing: SETTLE_EASING,
          fill: 'both',
          composite,
        },
      ),
    )
  }
  return {
    to,
    stop,
    rest: () => {
      to(0)
      for (const animation of running) {
        void animation.finished.then(
          () => animation.cancel(),
          () => undefined,
        )
      }
    },
  }
}
