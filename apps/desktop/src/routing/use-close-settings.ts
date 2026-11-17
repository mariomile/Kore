import { useCallback } from 'react'
import { useRouter } from './router'

/**
 * Leave Settings for the route it was opened from, or today when it was the
 * first thing the window showed. Shared by the modal's Escape and outside
 * click and the Close button in its sidebar.
 */
export function useCloseSettings(): () => void {
  const { back, canBack, navigate } = useRouter()
  return useCallback((): void => {
    if (canBack) {
      back()
      return
    }
    navigate({ kind: 'today' })
  }, [back, canBack, navigate])
}
