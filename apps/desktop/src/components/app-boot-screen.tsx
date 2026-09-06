import type { ReactElement } from 'react'

const KORE_MARK = new URL('./kore-mark.png', import.meta.url).href

/**
 * What the window shows while the graph opens.
 *
 * Boot is short but not instant — the shell resolves the last graph, opens the
 * index, and waits on a first paint. The gem mark (no app-icon squircle) sits
 * at splash scale with a slow breathe so the wait reads as "started, working"
 * rather than a blank frame. Light themes invert the grayscale artwork so the
 * same asset stays a mark, not a white blob on paper.
 *
 * `prefers-reduced-motion` stops the breathe app-wide (styles/index.css).
 */
export function AppBootScreen(): ReactElement {
  return (
    <div
      role="status"
      aria-label="Opening your graph"
      className="flex h-screen w-screen items-center justify-center bg-surface-app"
    >
      <span aria-hidden className="reflect-boot-mark">
        <img src={KORE_MARK} alt="" className="h-24 w-auto invert dark:invert-0" />
      </span>
    </div>
  )
}
