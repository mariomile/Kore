import { useEffect, useEffectEvent, type RefObject } from 'react'
import { hapticImpactLight } from '@/mobile/haptics'

/** How far (px) a pull must travel before letting go opens search. */
export const PULL_TO_SEARCH_THRESHOLD = 72

/** Movement (px) that decides whether a touch is a vertical pull at all. */
const DECIDE_SLOP = 10

/**
 * A touch held this long before it moves is a long press (text selection,
 * block menus), not a pull.
 */
const LONG_PRESS_MS = 400

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
 * day carousel, row swipes) or a long press abandons it.
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
    let startTime = 0

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
      startTime = event.timeStamp
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
        if (dy <= 0 || Math.abs(dx) >= dy || event.timeStamp - startTime > LONG_PRESS_MS) {
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
