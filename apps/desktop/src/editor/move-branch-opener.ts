import type { EditorView } from '@prosekit/pm/view'
import { lastFocusedEditor } from './focused-editor'

/**
 * Who opens "Move to…" for an editor (Plan 33 C2). Kept apart from the picker
 * component so the command registry can reach it without loading React UI.
 */

/** The editor-scope binding that moves the caret's branch to another note. */
export const MOVE_BRANCH_BINDING = 'Mod-Shift-m'

/** Opens the picker for the block at `pos` (the caret's when absent); false when it can't. */
export type MoveBranchOpener = (pos?: number) => boolean

const openers = new WeakMap<EditorView, MoveBranchOpener>()

export function registerMoveBranchOpener(view: EditorView, opener: MoveBranchOpener): void {
  openers.set(view, opener)
}

export function unregisterMoveBranchOpener(view: EditorView): void {
  openers.delete(view)
}

/** Open "Move to…" for the block at `pos` in `view`; false when it can't move. */
export function openMoveBranch(view: EditorView, pos?: number): boolean {
  return openers.get(view)?.(pos) ?? false
}

/** Whether this editor offers "Move to…". */
export function hasMoveBranch(view: EditorView): boolean {
  return openers.has(view)
}

/** The palette entry: open "Move to…" for the caret's branch in the last focused note. */
export function moveBranchFromLastFocused(): boolean {
  const view = lastFocusedEditor()
  return view !== null && openMoveBranch(view)
}
