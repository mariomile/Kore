import { useEffect, useState } from 'react'

/**
 * `data-near-viewport-scroller` marks a scroller whose content watches with
 * a margin. A root margin grows the viewport only: content inside a scroller
 * of its own is still clipped to that scroller's box, so "within 400px"
 * would mean "on screen". Elements under a marked scroller are observed
 * against it instead.
 */
const SCROLLER_SELECTOR = '[data-near-viewport-scroller]'

/**
 * One IntersectionObserver per root and rootMargin, shared by every element
 * watching with it — the shape the API is built for. A hundred grid cards
 * each pay one `observe()` on the shared instance instead of constructing
 * their own observer (whose fixed per-observer work — root bounds, margins,
 * clip chain — the engine would repeat per instance on every intersection
 * pass).
 */
const viewportObservers = new Map<string, IntersectionObserver>()
const scrollerObservers = new WeakMap<Element, Map<string, IntersectionObserver>>()
const callbacks = new WeakMap<Element, (approached: boolean) => void>()
/** Elements an observer has reported as away: one that is near later came from there. */
const away = new WeakSet<Element>()

function observerFor(margin: string, scroller: Element | null): IntersectionObserver {
  let observers = viewportObservers
  if (scroller !== null) {
    observers = scrollerObservers.get(scroller) ?? new Map<string, IntersectionObserver>()
    scrollerObservers.set(scroller, observers)
  }
  let observer = observers.get(margin)
  if (observer === undefined) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            callbacks.get(entry.target)?.(away.has(entry.target))
          } else {
            away.add(entry.target)
          }
        }
      },
      { root: scroller, rootMargin: margin },
    )
    observers.set(margin, observer)
  }
  return observer
}

/**
 * Whether an element has come within `margin` of the viewport, once — the
 * flag latches on the first approach and the element is unobserved. For
 * content that upgrades as it nears view (the note-grid card previews) and
 * never downgrades back. `approached` tells an element that came near from
 * farther away (it was scrolled to) from one that was near when first seen
 * (it appeared there).
 */
export function useNearViewport(margin: string): {
  setRoot: (root: HTMLElement | null) => void
  near: boolean
  approached: boolean
} {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [state, setState] = useState<'away' | 'appeared' | 'approached'>('away')
  const near = state !== 'away'

  useEffect(() => {
    if (near || root === null || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = observerFor(margin, root.closest(SCROLLER_SELECTOR))
    callbacks.set(root, (approached) => {
      setState(approached ? 'approached' : 'appeared')
    })
    observer.observe(root)
    return () => {
      callbacks.delete(root)
      observer.unobserve(root)
    }
  }, [near, root, margin])

  return { setRoot, near, approached: state === 'approached' }
}
