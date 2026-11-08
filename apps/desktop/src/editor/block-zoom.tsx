import { useMemo, type ReactElement } from 'react'
import { Priority } from '@meowdown/core'
import { definePlugin } from '@prosekit/core'
import { useExtension, useKeymap } from '@meowdown/react'
import { blockZoomKeymap, createBlockZoomPlugin } from './block-zoom-plugin'

/**
 * Zoom into a block (Plan 33, C1): ⌘⇧. on any block, or ⌘-click on a bullet,
 * shows only that block (a list item with its children, a heading with its
 * section); ⌘⇧, or the breadcrumb goes back up. View state only; the note's
 * Markdown never changes. Mounted as a NoteEditor child.
 */
export function BlockZoom(): ReactElement | null {
  // High priority: the ⌘-click must reach this plugin before meowdown's
  // marker handler, which would fold the bullet instead.
  useExtension(
    useMemo(() => definePlugin(createBlockZoomPlugin()), []),
    { priority: Priority.high },
  )
  useKeymap(blockZoomKeymap, { priority: Priority.high })
  return null
}
