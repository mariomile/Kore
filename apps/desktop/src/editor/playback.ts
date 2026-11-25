/**
 * One piece of media at a time across the app's notes: a link card's player
 * or a vault video or audio file. Whatever starts claims playback, and the
 * previous claimant is stopped (a link player goes back to its card, a vault
 * file pauses).
 */
let current: (() => void) | null = null

/** Start playing: stop whatever else plays, and remember how to stop this. */
export function claimPlayback(stop: () => void): void {
  if (current !== null && current !== stop) {
    const previous = current
    current = null
    previous()
  }
  current = stop
}

/** This stopped on its own (closed, paused, ended): forget it. */
export function releasePlayback(stop: () => void): void {
  if (current === stop) {
    current = null
  }
}
