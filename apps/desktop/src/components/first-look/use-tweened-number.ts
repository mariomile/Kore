import { useEffect, useRef, useState } from 'react'

/** How long a counter takes to catch up with a new value. */
const TWEEN_MS = 450

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A number that rolls toward each new value instead of jumping, so a count
 * re-read every half second reads as one climb. Reduced motion, and the
 * first value, land at once.
 */
export function useTweenedNumber(target: number): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)

  useEffect(() => {
    const from = shownRef.current
    if (from === target || prefersReducedMotion()) {
      shownRef.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / TWEEN_MS)
      // Ease-out cubic: fast off the mark, settling onto the value.
      const value = Math.round(from + (target - from) * (1 - (1 - t) ** 3))
      shownRef.current = value
      setShown(value)
      if (t < 1) {
        frame = requestAnimationFrame(step)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [target])

  return shown
}
