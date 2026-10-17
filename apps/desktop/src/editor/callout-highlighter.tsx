import { useMemo, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { useExtension } from '@meowdown/react'
import { createCalloutPlugin } from './callout-plugin'

/**
 * Draw Obsidian callouts (`> [!note]- Title`) in the live editor. meowdown
 * has no callout node, so the markdown stays a blockquote and this plugin
 * only decorates it: the kind's color and icon, the title line, the
 * `[!type]±` token hidden until the caret is on that line, and a fold button
 * for `+`/`-` callouts. Folding is view state only and never rewrites the
 * file; a caret inside a folded body shows it. Mounted as a NoteEditor child.
 */
export function CalloutHighlighter(): ReactElement | null {
  useExtension(useMemo(() => definePlugin(createCalloutPlugin()), []))
  return null
}
