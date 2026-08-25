import { getCurrentWindow } from '@tauri-apps/api/window'
import { hasMacosTitleBarOverlay } from '@/lib/window-chrome'

/**
 * Live macOS-window fullscreen as a module-level store. The traffic-light
 * band keys off this: overlay title-bar chrome still reports
 * {@link hasMacosTitleBarOverlay} in fullscreen, but the lights themselves
 * are gone, so layout must drop the reserved strip.
 *
 * One resize listener + one `isFullscreen` reader per window, not per
 * mounted hook. Resize is the signal native fullscreen actually sends
 * (the webview size changes); Tauri has no dedicated fullscreen event.
 */

let fullscreen = false
const listeners = new Set<() => void>()
let syncing = false
let resync = false
/** Bumped on `stop` so an in-flight `isFullscreen` can't write after teardown. */
let generation = 0

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

async function readFullscreen(started: number): Promise<void> {
  try {
    const next = await getCurrentWindow().isFullscreen()
    if (started !== generation || next === fullscreen) {
      return
    }
    fullscreen = next
    emit()
  } catch {
    // No Tauri window internals (browser tests, a missing injection). Leave
    // the last snapshot: assuming windowed keeps the inset up rather than
    // sliding the Home pill under still-visible lights.
  }
}

function requestSync(): void {
  if (syncing) {
    resync = true
    return
  }
  syncing = true
  const started = generation
  void readFullscreen(started).finally(() => {
    if (started !== generation) {
      return
    }
    syncing = false
    if (resync) {
      resync = false
      requestSync()
    }
  })
}

function start(): void {
  requestSync()
  window.addEventListener('resize', requestSync)
}

function stop(): void {
  generation += 1
  window.removeEventListener('resize', requestSync)
  fullscreen = false
  syncing = false
  resync = false
}

/**
 * `useSyncExternalStore` subscribe. The native reader runs only while the
 * overlay title bar is in play — other platforms never indent for lights,
 * so they have nothing to sync.
 */
export function subscribeMacosFullscreen(listener: () => void): () => void {
  if (!hasMacosTitleBarOverlay) {
    return () => {}
  }
  const first = listeners.size === 0
  listeners.add(listener)
  if (first) {
    start()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stop()
    }
  }
}

/** Current fullscreen snapshot; `false` until the first native read lands. */
export function getMacosFullscreenSnapshot(): boolean {
  return fullscreen
}

/**
 * Drop every subscriber and the native reader. Tests call this so a case
 * that failed to unmount can't leave fullscreen state running into the next.
 */
export function resetMacosFullscreenStore(): void {
  listeners.clear()
  stop()
}
