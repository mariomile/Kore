import type { EditorView } from '@prosekit/pm/view'
import { errorMessage } from '@reflect/core'
import { startOperation } from '@/lib/operations'
import {
  blockLinkText,
  canLinkToBlock,
  ensureBlockIdAt,
  ensureBlockIdAtCaret,
} from './block-id-plugin'
import { lastFocusedEditor } from './focused-editor'

/**
 * "Copy link to line" (Plan 33 C3): give the block an Obsidian `^id` when it
 * has none (only that line changes), then put `[[Note#^id]]` on the clipboard.
 * `pos` is a block handle's block; without it, the caret's line. Confirms
 * through the operations status line, like "Copy deep link".
 */
export async function copyLinkToBlock(view: EditorView, pos?: number): Promise<boolean> {
  if (!canLinkToBlock(view)) {
    return false
  }
  const id = pos === undefined ? ensureBlockIdAtCaret(view) : ensureBlockIdAt(view, pos)
  const link = id === null ? null : blockLinkText(view, id)
  if (link === null) {
    startOperation('Copying link to line').fail(
      'Couldn’t add a link to this line here. Zoom out and try again.',
    )
    return false
  }
  try {
    await navigator.clipboard.writeText(link)
    startOperation('Link to line copied').done()
    return true
  } catch (cause) {
    startOperation('Copying link to line').fail(errorMessage(cause))
    return false
  }
}

/** The palette entry: copy a link to the caret's line in the last focused note. */
export function copyLinkToLastFocusedLine(): boolean {
  const view = lastFocusedEditor()
  if (view === null || !canLinkToBlock(view)) {
    return false
  }
  void copyLinkToBlock(view)
  return true
}
