import { noteEditorHandleFor } from './editor-handle-registry'

export type EditorHistoryDirection = 'undo' | 'redo'

/**
 * Run history in the focused note editor, falling back to the browser's
 * native editable control history for inputs such as property fields.
 */
export function runFocusedEditorHistory(
  path: string | null,
  direction: EditorHistoryDirection,
): void {
  const activeElement = document.activeElement
  if (
    path !== null &&
    activeElement instanceof Element &&
    activeElement.closest('.ProseMirror') !== null
  ) {
    const handle = noteEditorHandleFor(path)
    if (handle !== null) {
      handle[direction]()
      return
    }
  }

  if (typeof document.execCommand === 'function') {
    document.execCommand(direction)
  }
}
