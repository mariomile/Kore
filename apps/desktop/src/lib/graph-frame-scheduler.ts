/**
 * One frame at a time, only while the graph is moving or needs a repaint.
 * The renderer returns true to continue the simulation. A settled graph has
 * no pending callback; interaction requests wake it without a polling loop.
 */
export function createGraphFrameScheduler(renderFrame: () => boolean): {
  request: () => void
  dispose: () => void
} {
  let frameId: number | null = null
  let disposed = false

  function request(): void {
    if (disposed || frameId !== null || document.visibilityState === 'hidden') {
      return
    }
    frameId = requestAnimationFrame(frame)
  }

  function frame(): void {
    frameId = null
    if (disposed || document.visibilityState === 'hidden') {
      return
    }
    if (renderFrame()) {
      request()
    }
  }

  function cancelPending(): void {
    if (frameId !== null) {
      cancelAnimationFrame(frameId)
      frameId = null
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      cancelPending()
    } else {
      request()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    request,
    dispose: () => {
      disposed = true
      cancelPending()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
}
