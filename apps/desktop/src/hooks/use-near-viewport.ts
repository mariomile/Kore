import { useEffect, useState } from 'react'

/**
 * One IntersectionObserver per rootMargin, shared by every element watching
 * with it — the shape the API is built for. A hundred grid cards each pay
 * one `observe()` on the shared instance instead of constructing their own
 * observer (whose fixed per-observer work — root bounds, margins, clip
 * chain — the engine would repeat per instance on every intersection pass).
 */
const observers = new Map<string, IntersectionObserver>()
const callbacks = new WeakMap<Element, () => void>()

function observerFor(margin: string): IntersectionObserver {
  let observer = observers.get(margin)
  if (observer === undefined) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            callbacks.get(entry.target)?.()
          }
        }
      },
      { rootMargin: margin },
    )
    observers.set(margin, observer)
  }
  return observer
}

/**
 * Whether an element has come within `margin` of the viewport, once — the
 * flag latches on the first approach and the element is unobserved. For
 * content that upgrades as it nears view (the note-grid card previews) and
 * never downgrades back.
 */
export function useNearViewport(margin: string): {
  setRoot: (root: HTMLElement | null) => void
  near: boolean
} {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (near || root === null || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = observerFor(margin)
    callbacks.set(root, () => {
      setNear(true)
    })
    observer.observe(root)
    return () => {
      callbacks.delete(root)
      observer.unobserve(root)
    }
  }, [near, root, margin])

  return { setRoot, near }
}
