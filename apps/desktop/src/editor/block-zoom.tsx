import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { Priority } from '@meowdown/core'
import { definePlugin } from '@prosekit/core'
import { useExtension, useKeymap } from '@meowdown/react'
import { isTouchEditorSurface } from '@/lib/platform-surface'
import { useOptionalRouter } from '@/routing/router'
import { blockZoomKeymap, createBlockZoomPlugin, zoomOut } from './block-zoom-plugin'
import { zoomFloor } from './block-zoom-state'
import { sameTarget } from './block-zoom-target'

/**
 * Zoom into a block (Plan 33, C1): ⌘⇧. on any block, ⌘-click on a bullet, or
 * a tap on a bullet on the phone, shows only that block (a list item with its
 * children, a heading with its section); ⌘⇧, Escape, Back (⌘[, the toolbar
 * arrow, the phone's header arrow) or the breadcrumb go back up. View state
 * only; the note's Markdown never changes. Mounted as a NoteEditor child.
 */
export function BlockZoom(): ReactElement | null {
  const router = useOptionalRouter()
  const setViewBack = router?.setViewBack
  const latest = useRef(setViewBack)
  latest.current = setViewBack
  // One identity per mounted editor: the router keys this view's Back step by it.
  const owner = useMemo(() => ({}), [])

  // High priority: the ⌘-click must reach this plugin before meowdown's
  // marker handler, which would fold the bullet instead.
  useExtension(
    useMemo(
      () =>
        definePlugin(
          createBlockZoomPlugin({
            onZoomChange: (view, target) => {
              // At the zoom the screen opened on (a page opened as its own
              // screen), Back leaves the screen in one step.
              const atFloor = target === null || sameTarget(target, zoomFloor(view.state))
              latest.current?.(
                owner,
                atFloor ? null : () => zoomOut(view.state, view.dispatch, view),
              )
            },
            tapToZoom: isTouchEditorSurface(),
          }),
        ),
      [owner],
    ),
    { priority: Priority.high },
  )
  useKeymap(blockZoomKeymap, { priority: Priority.high })
  useEffect(() => () => setViewBack?.(owner, null), [owner, setViewBack])
  return null
}
