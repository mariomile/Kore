import { useMemo, type ReactElement } from 'react'
import { Priority } from '@meowdown/core'
import { definePlugin } from '@prosekit/core'
import { useExtension, useKeymap } from '@meowdown/react'
import { createListZoomPlugin, listZoomKeymap } from './list-zoom-plugin'

/**
 * Zoom into a list item (Plan 33, C1): ⌘-click a bullet or press ⌘⇧. to see
 * only that item and its children, ⌘⇧, or the breadcrumb to go back up. View
 * state only; the note's Markdown never changes. Mounted as a NoteEditor child.
 */
export function ListZoom(): ReactElement | null {
  // High priority: the ⌘-click must reach this plugin before meowdown's
  // marker handler, which would fold the bullet instead.
  useExtension(
    useMemo(() => definePlugin(createListZoomPlugin()), []),
    { priority: Priority.high },
  )
  useKeymap(listZoomKeymap, { priority: Priority.high })
  return null
}
