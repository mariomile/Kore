import { useCallback, useEffect, useRef, useState } from 'react'

interface SearchHeaderFocus {
  readonly isFocused: boolean
  readonly onFocus: () => void
  readonly onBlur: () => void
}

/**
 * Tracks focus for a search header that compacts while the keyboard is up.
 * Expansion waits until the active tap completes: expanding synchronously on
 * blur can move an adjacent control between pointer-down and click, cancelling
 * the action the user just touched.
 */
export function useSearchHeaderFocus(): SearchHeaderFocus {
  const [isFocused, setIsFocused] = useState(false)
  const blurTimeoutRef = useRef<number | null>(null)

  const onFocus = useCallback((): void => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
    setIsFocused(true)
  }, [])

  const onBlur = useCallback((): void => {
    blurTimeoutRef.current = window.setTimeout(() => {
      setIsFocused(false)
      blurTimeoutRef.current = null
    }, 200)
  }, [])

  useEffect(
    () => () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current)
      }
    },
    [],
  )

  return { isFocused, onFocus, onBlur }
}
