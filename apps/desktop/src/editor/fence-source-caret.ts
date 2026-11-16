import { useCallback, type MouseEvent } from 'react'
import { useEditor } from '@meowdown/react'
import { TextSelection } from '@prosekit/pm/state'

/**
 * A mousedown handler for a widget Meowdown's `renderCodeBlock` draws in
 * place of a fence: it puts the caret at the start of the fence's source, as
 * Meowdown's own preview does, so the widget is edited where it is drawn.
 * Presses on the widget's own controls (buttons, links, frames) are left to
 * them.
 */
export function useFenceSourceCaret(): (event: MouseEvent<HTMLElement>) => void {
  const editor = useEditor()
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element && event.target.closest('button, a, iframe') !== null)
      ) {
        return
      }
      const pre = event.currentTarget.closest('[data-meowdown-code-block-custom]')?.parentElement
        ?.firstElementChild
      if (!(pre instanceof HTMLElement) || pre.localName !== 'pre' || !editor.mounted) {
        return
      }
      event.preventDefault()
      const { view } = editor
      let position: number
      try {
        position = view.posAtDOM(pre, 0)
      } catch {
        return
      }
      const selection = TextSelection.near(view.state.doc.resolve(position), 1)
      view.dispatch(view.state.tr.setSelection(selection))
      view.focus()
    },
    [editor],
  )
}
