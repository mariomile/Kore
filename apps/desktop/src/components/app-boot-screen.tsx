import type { ReactElement } from 'react'

/**
 * What the window shows while the graph opens.
 *
 * Boot is short but not instant — the shell resolves the last graph, opens the
 * index, and waits on a first paint — and the word "Loading…" spends that time
 * saying nothing. The wordmark with a slow sheen crossing it says the same
 * thing an app's launch animation always says: it started, it is working, wait
 * a beat. The sheen is a masked gradient over the type rather than an image,
 * so it inherits the theme, needs no asset, and costs one compositor layer.
 *
 * `prefers-reduced-motion` stops the sweep app-wide (styles/index.css), which
 * leaves the wordmark sitting still — still the right thing to show.
 */
export function AppBootScreen(): ReactElement {
  return (
    <div
      role="status"
      aria-label="Opening your graph"
      className="flex h-screen w-screen items-center justify-center bg-surface-app"
    >
      <span aria-hidden className="reflect-boot-mark text-2xl font-semibold tracking-tight">
        Kore
      </span>
    </div>
  )
}
