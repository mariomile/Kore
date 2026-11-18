import { useEffect, useEffectEvent, type ReactElement, type Ref, type RefObject } from 'react'
import { Search } from '@/components/icons'
import { hapticImpactLight } from '@/mobile/haptics'

/** How far (px) a pull must travel before letting go opens search. */
export const PULL_TO_SEARCH_THRESHOLD = 72

/** Movement (px) that decides whether a touch is a vertical pull at all. */
const DECIDE_SLOP = 10

interface PullToSearchOptions {
  /** The surface whose touches are watched (the shell's screen stack). */
  container: RefObject<HTMLElement | null>
  /** The indicator whose `--pull` (0…1) and `data-armed` the hook drives. */
  indicator: RefObject<HTMLElement | null>
  /** Off while typing, on screens with their own search, and while open. */
  enabled: boolean
  onOpen: () => void
}

/**
 * The nearest vertical scroller between `target` and `root` — the element
 * whose top edge decides whether a downward drag is a scroll or a pull.
 */
function scrollerFor(target: Element, root: Element): Element | null {
  for (
    let node: Element | null = target;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    if (node.scrollHeight > node.clientHeight) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return node
      }
    }
  }
  return null
}

/**
 * Pull down from the top of a screen to open global search (iOS Spotlight's
 * gesture). Armed only when the touch starts with its scroller already at the
 * top, so ordinary scrolling never triggers it; a mostly-horizontal drag (the
 * day carousel, row swipes) abandons it, and a native long press (text
 * selection) cancels the touch, which resets it.
 *
 * Passive listeners and direct style writes only: the pull runs on every
 * touchmove, so it never re-renders React and never blocks native scrolling
 * (WebKit's rubber band at the top is the visual pull; the indicator rides
 * in the gap it opens).
 */
export function usePullToSearch({
  container,
  indicator,
  enabled,
  onOpen,
}: PullToSearchOptions): void {
  const open = useEffectEvent(onOpen)

  useEffect(() => {
    const root = container.current
    if (!enabled || root === null) {
      return
    }

    let tracking = false
    let engaged = false
    let armed = false
    let startX = 0
    let startY = 0

    const paint = (progress: number, nextArmed: boolean): void => {
      const element = indicator.current
      if (element === null) {
        return
      }
      element.style.setProperty('--pull', progress.toFixed(3))
      if (nextArmed) {
        element.setAttribute('data-armed', '')
      } else {
        element.removeAttribute('data-armed')
      }
    }

    const reset = (): void => {
      tracking = false
      engaged = false
      armed = false
      paint(0, false)
    }

    const onTouchStart = (event: TouchEvent): void => {
      reset()
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (touch === undefined || !(event.target instanceof Element)) {
        return
      }
      const scroller = scrollerFor(event.target, root)
      if (scroller !== null && scroller.scrollTop > 0) {
        return
      }
      tracking = true
      startX = touch.clientX
      startY = touch.clientY
    }

    const onTouchMove = (event: TouchEvent): void => {
      if (!tracking) {
        return
      }
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (touch === undefined) {
        reset()
        return
      }
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!engaged) {
        if (Math.abs(dx) < DECIDE_SLOP && Math.abs(dy) < DECIDE_SLOP) {
          return
        }
        if (dy <= 0 || Math.abs(dx) >= dy) {
          reset()
          return
        }
        engaged = true
      }
      const progress = Math.min(1, Math.max(0, dy) / PULL_TO_SEARCH_THRESHOLD)
      const nextArmed = progress >= 1
      if (nextArmed && !armed) {
        hapticImpactLight()
      }
      armed = nextArmed
      paint(progress, armed)
    }

    const onTouchEnd = (): void => {
      const shouldOpen = engaged && armed
      reset()
      if (shouldOpen) {
        open()
      }
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: true })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    root.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', reset)
      reset()
    }
  }, [container, indicator, enabled])
}

/**
 * The pull-to-search indicator: a "Search" capsule that drops in from above
 * the top edge as the pull travels (`--pull`, 0…1, written by
 * {@link usePullToSearch}) and fills with the accent once letting go would
 * open search (`data-armed`). Pure CSS on purpose: the pull repaints it on
 * every touchmove without a React render, and only `transform` moves.
 */
export function PullToSearchIndicator({ ref }: { ref: Ref<HTMLDivElement> }): ReactElement {
  return (
    <div
      ref={ref}
      aria-hidden
      className="group pointer-events-none absolute inset-x-0 top-0 z-50 flex justify-center"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 0.375rem)',
        transform: 'translate3d(0, calc((var(--pull, 0) - 1) * (100% + 0.5rem)), 0)',
        // Fully transparent at rest: the capsule's shadow would otherwise
        // peek below the top edge (under the Dynamic Island).
        opacity: 'calc(var(--pull, 0) * 4)',
      }}
    >
      <span className="flex h-11 items-center gap-2 rounded-full bg-surface px-5 text-[15px] font-medium text-text-secondary shadow-[0_4px_20px_rgb(0_0_0/0.12)] ring-1 ring-foreground/10 transition-colors duration-150 group-data-armed:bg-primary group-data-armed:text-primary-foreground group-data-armed:ring-transparent motion-reduce:transition-none">
        <Search aria-hidden className="size-[18px]" />
        Search
      </span>
    </div>
  )
}
