/**
 * The boot splash: the `#kore-boot` mark that `index.html` paints in the
 * webview's very first frame, over everything React renders underneath.
 *
 * Launch used to be a string of swaps: the native launch screen, a blank
 * frame while the bundle loaded, an empty frame while the platform chunk
 * resolved, the mark again once `AppBootScreen` mounted (its image decoding
 * a beat later), then the workspace arriving in pieces. One static element
 * that stays put until the first real screen has painted, then fades, turns
 * all of that into a single cross-fade from the mark to the app.
 *
 * Release points, in the order they usually happen:
 * - `'shell'`: the workspace mounted. Its first editor normally follows
 *   within a frame or two, so the splash waits up to `SHELL_GRACE_MS` for it
 *   rather than revealing an empty note pane.
 * - `'content'`: the first note editor mounted. Reveal now.
 * - `'screen'`: a screen with no editor to wait for (the vault chooser,
 *   onboarding, an open error). Reveal now.
 *
 * Call sites release from layout effects, so the fade is queued in the same
 * frame the first screen commits rather than a frame or more later. The
 * editor typeface is preloaded by index.html, so the revealed screen is
 * already in its real font without waiting on `document.fonts`.
 */

const SPLASH_ID = 'kore-boot'
const LEAVING_CLASS = 'kore-boot-leaving'

/** How long a mounted workspace may wait for its first editor. */
export const SHELL_GRACE_MS = 600

/** Fallback removal when `transitionend` never arrives (hidden window). */
const FADE_FALLBACK_MS = 400

export type BootSplashRelease = 'shell' | 'content' | 'screen'

let revealing = false
let graceTimer: ReturnType<typeof setTimeout> | undefined

export function releaseBootSplash(reason: BootSplashRelease): void {
  if (revealing || typeof document === 'undefined') {
    return
  }
  if (reason === 'shell') {
    graceTimer ??= setTimeout(reveal, SHELL_GRACE_MS)
    return
  }
  reveal()
}

function reveal(): void {
  if (revealing) {
    return
  }
  revealing = true
  clearTimeout(graceTimer)
  const splash = document.getElementById(SPLASH_ID)
  if (splash === null) {
    return
  }
  // Two frames: the first lets the commit that triggered the release lay out
  // and paint under the splash, the second starts the fade on a frame where
  // that content is already on screen.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fadeOut(splash)
    })
  })
}

function fadeOut(splash: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove()
    return
  }
  const done = (): void => {
    splash.remove()
  }
  splash.addEventListener('transitionend', done, { once: true })
  setTimeout(done, FADE_FALLBACK_MS)
  splash.classList.add(LEAVING_CLASS)
}

/** Test seam: forget a previous reveal so each test starts from a fresh boot. */
export function resetBootSplashForTests(): void {
  revealing = false
  clearTimeout(graceTimer)
  graceTimer = undefined
}
