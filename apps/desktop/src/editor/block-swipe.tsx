import { useLayoutEffect, type ReactElement } from 'react'
import { useEditor } from '@meowdown/react'
import { classifyBlockSwipe, isHorizontalDrag } from './block-swipe-gestures'
import { whenEditorMounted } from './when-editor-mounted'

/** ProseKit's list commands, as this component needs to call them. */
interface ListCommands {
  indentList?: () => void
  dedentList?: () => void
}

interface SelectionClass<Selection, Position> {
  near(position: Position): Selection
}

function selectionNear<Selection extends object, Position>(
  selection: Selection,
  position: Position,
): Selection {
  // ProseKit exposes the concrete selection instance but not its class through
  // Meowdown. Every ProseMirror selection class inherits Selection.near.
  const selectionClass = selection.constructor as typeof selection.constructor &
    SelectionClass<Selection, Position>
  return selectionClass.near(position)
}

/**
 * Craft-style block handling on touch.
 *
 * The gutter grip that reorders blocks is pointer-only — it appears on hover
 * and needs a precise drag — so `NoteEditor` pins it off on the touch surface,
 * which left the mobile editor with no way to restructure an outline at all
 * except the software keyboard's Tab, if the keyboard has one. Craft's answer
 * is the sideways swipe, and it is the one gesture a thumb can aim: drag a
 * line right to indent it, left to outdent.
 *
 * The handler is deliberately reluctant. It claims a gesture only once the
 * drag is clearly horizontal ({@link isHorizontalDrag}), acts only when it
 * travels far enough ({@link classifyBlockSwipe}), and never touches a
 * multi-touch gesture — a pinch-zoom or a two-finger scroll passes straight
 * through. Everything else stays the browser's, because a swipe that steals
 * scrolling is worse than no swipe.
 *
 * Mounted as a `NoteEditor` child so it lives inside the ProseKit context for
 * the editor session and detaches with it.
 */
export function BlockSwipeGestures(): ReactElement | null {
  const editor = useEditor()

  useLayoutEffect(() => {
    let cleanup: (() => void) | null = null
    const cancelMount = whenEditorMounted(editor, () => {
      const dom = editor.view.dom
      let startX: number | null = null
      let startY: number | null = null
      let startPosition: number | null = null
      let claimed = false

      const reset = (): void => {
        startX = null
        startY = null
        startPosition = null
        claimed = false
      }

      const onTouchStart = (event: TouchEvent): void => {
        if (event.touches.length !== 1) {
          reset()
          return
        }
        const touch = event.touches[0]
        startX = touch?.clientX ?? null
        startY = touch?.clientY ?? null
        startPosition =
          touch === undefined
            ? null
            : (editor.view.posAtCoords({ left: touch.clientX, top: touch.clientY })?.pos ?? null)
        claimed = false
      }

      const onTouchMove = (event: TouchEvent): void => {
        if (startX === null || startY === null) {
          return
        }
        if (event.touches.length !== 1) {
          reset()
          return
        }
        const touch = event.touches[0]
        if (touch === undefined) {
          return
        }
        if (!claimed && isHorizontalDrag(touch.clientX - startX, touch.clientY - startY)) {
          claimed = true
        }
        if (claimed && event.cancelable) {
          // Only once the gesture is ours: cancelling earlier would kill the
          // page scroll for every touch that starts on the editor.
          event.preventDefault()
        }
      }

      const onTouchEnd = (event: TouchEvent): void => {
        const touch = event.changedTouches[0]
        if (startX === null || startY === null || touch === undefined || !claimed) {
          reset()
          return
        }
        const swipe = classifyBlockSwipe(touch.clientX - startX, touch.clientY - startY)
        const position = startPosition
        reset()
        if (swipe === null || position === null) {
          return
        }
        const view = editor.view
        const boundedPosition = Math.min(Math.max(position, 0), view.state.doc.content.size)
        const selection = selectionNear(
          view.state.selection,
          view.state.doc.resolve(boundedPosition),
        )
        view.dispatch(view.state.tr.setSelection(selection))

        const commands = editor.commands as ListCommands
        if (swipe === 'indent') {
          commands.indentList?.()
        } else {
          commands.dedentList?.()
        }
      }

      // Not passive: a committed swipe must be able to cancel the scroll.
      dom.addEventListener('touchstart', onTouchStart, { passive: true })
      dom.addEventListener('touchmove', onTouchMove, { passive: false })
      dom.addEventListener('touchend', onTouchEnd, { passive: true })
      dom.addEventListener('touchcancel', reset, { passive: true })
      cleanup = () => {
        dom.removeEventListener('touchstart', onTouchStart)
        dom.removeEventListener('touchmove', onTouchMove)
        dom.removeEventListener('touchend', onTouchEnd)
        dom.removeEventListener('touchcancel', reset)
      }
    })
    return () => {
      cancelMount()
      cleanup?.()
    }
  }, [editor])

  return null
}
