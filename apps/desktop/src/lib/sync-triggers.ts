/**
 * When a connected graph pulls other devices' changes, besides the edits
 * that drive the engine's own debounce:
 *
 * - **resume**: window focus (desktop refocus) and visibility → visible
 *   (mobile app resume; desktop unminimize, which doesn't reliably fire
 *   `focus`). One resume fires several of these, so triggers inside
 *   {@link RESUME_DEDUPE_MS} collapse into one cycle;
 * - **back online**: the `offline` state's recovery;
 * - **while open**: every {@link FOREGROUND_PULL_MS} while the app is in
 *   the foreground, so a Mac left open while you write on the phone
 *   doesn't keep editing a stale copy. A cycle with nothing new costs one
 *   cheap fetch, and a hidden or offline app never polls.
 *
 * Returns the disposer that removes every listener and the timer.
 */
export function installSyncTriggers(syncNow: () => Promise<void>): () => void {
  let lastResumeAt = 0
  const onResume = (): void => {
    const now = Date.now()
    if (now - lastResumeAt < RESUME_DEDUPE_MS) {
      return
    }
    lastResumeAt = now
    void syncNow()
  }
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      onResume()
    }
  }
  const onOnline = (): void => {
    void syncNow()
  }
  const poll = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void syncNow()
    }
  }, FOREGROUND_PULL_MS)

  window.addEventListener('focus', onResume)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)
  return () => {
    clearInterval(poll)
    window.removeEventListener('focus', onResume)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', onOnline)
  }
}

/**
 * Resume events inside this window collapse into one cycle. Thirty seconds
 * prevents rapid window switching or dismissing an OS dialog from kicking off
 * repeated multi-second git commit/fetch runs on large vaults while still
 * pulling promptly when returning after a break.
 */
export const RESUME_DEDUPE_MS = 30_000

/** How often an app in the foreground checks for other devices' changes. */
export const FOREGROUND_PULL_MS = 2 * 60_000
