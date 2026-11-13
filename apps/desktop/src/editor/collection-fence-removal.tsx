import { useCallback, useRef, type ReactElement, type ReactNode } from 'react'
import { useEditor } from '@meowdown/react'

interface CollectionFenceRemovalProps {
  /** Renders the widget; `remove` deletes this fence from the note. */
  children: (remove: () => void) => ReactNode
}

/**
 * Gives a rendered ` ```collection ` widget a way to delete its own fence.
 * Meowdown's code-block renderer hands the widget only the fence's text, and
 * the fence guard keeps the caret out of it, so on a touch screen (no block
 * grip, no hardware Backspace onto a selected block) an inserted collection
 * could not be removed at all. The widget's DOM position finds its code
 * block, which is deleted in one undoable transaction; the notes the
 * collection lists are untouched.
 */
export function CollectionFenceRemoval({ children }: CollectionFenceRemovalProps): ReactElement {
  const editor = useEditor()
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  const remove = useCallback(() => {
    const anchor = anchorRef.current
    if (anchor === null || !editor.mounted) {
      return
    }
    const { view } = editor
    let position: number
    try {
      position = view.posAtDOM(anchor, 0)
    } catch {
      return
    }
    const resolved = view.state.doc.resolve(position)
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).type.name === 'codeBlock') {
        view.dispatch(view.state.tr.delete(resolved.before(depth), resolved.after(depth)))
        return
      }
    }
  }, [editor])

  return (
    <>
      <span ref={anchorRef} hidden />
      {children(remove)}
    </>
  )
}
