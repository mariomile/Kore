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
 * On launch it sits under `index.html`'s boot splash (`src/lib/boot-splash.ts`),
 * an identical static copy that paints in the webview's first frame and only
 * lifts once a real screen is ready, so this component is what shows when the
 * splash is gone and a vault is (re)opening. iPhone's native launch screen
 * paints the same mark at the same size on the same background (gen/apple
 * LaunchScreen.storyboard). `h-dvh` keeps it centred on the full iOS viewport.
 *
 * `prefers-reduced-motion` stops the breathe app-wide (styles/index.css).
 */
export function AppBootScreen(): ReactElement {
  return (
    <div
      role="status"
      aria-label="Opening your vault"
      className="flex h-dvh w-screen items-center justify-center bg-surface-app"
    >
      <span aria-hidden className="kore-boot-mark">
        <img src={KORE_MARK} alt="" className="h-24 w-auto invert dark:invert-0" />
      </span>
    </div>
  )
}
