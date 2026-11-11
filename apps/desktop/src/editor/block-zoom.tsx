import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { Priority } from '@meowdown/core'
import { definePlugin } from '@prosekit/core'
import { useExtension, useKeymap } from '@meowdown/react'
import { useOptionalRouter } from '@/routing/router'
import { blockZoomKeymap, createBlockZoomPlugin, zoomOut } from './block-zoom-plugin'

/**
 * Zoom into a block (Plan 33, C1): ⌘⇧. on any block, or ⌘-click on a bullet,
 * shows only that block (a list item with its children, a heading with its
 * section); ⌘⇧, Escape, Back (⌘[ or the toolbar arrow) or the breadcrumb go
 * back up. View state only; the note's Markdown never changes. Mounted as a
 * NoteEditor child.
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
              latest.current?.(
                owner,
                target === null ? null : () => zoomOut(view.state, view.dispatch, view),
              )
            },
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
