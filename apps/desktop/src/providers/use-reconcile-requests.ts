import { useEffect } from 'react'
import { subscribeReconcileRequests } from '@reflect/core'

/**
 * A structural vault change (folder created, renamed, or removed) cannot
 * be expressed as per-file events; the watcher asks for one full reconcile
 * instead, and `refresh` coalesces bursts into a single queued rerun.
 */
export function useReconcileRequests(bridgeReady: boolean, refreshIndex: () => void): void {
  useEffect(() => {
    if (!bridgeReady) {
      return // bridgeless browser dev — no native event stream to subscribe to
    }
    let unlisten: (() => void) | null = null
    let disposed = false
    void subscribeReconcileRequests(() => refreshIndex()).then(
      (fn) => {
        if (disposed) {
          fn()
        } else {
          unlisten = fn
        }
      },
      (error: unknown) => console.error('failed to subscribe reconcile requests:', error),
    )
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [bridgeReady, refreshIndex])
}
