import { useEffect, useState } from 'react'

/**
 * An element's rendered height in px, kept current as it resizes: for
 * content that sits before a virtualized list in the same scroller, whose
 * height the virtualizer has to be told (virtua's `startMargin`). Returns
 * the height and the callback ref to attach; 0 while no element is attached.
 */
export function useElementHeight(): [number, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    if (element === null) {
      return
    }
    // A ResizeObserver reports the element's size once on observe, then on
    // every change.
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
      }
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [element])
  return [element === null ? 0 : height, setElement]
}
