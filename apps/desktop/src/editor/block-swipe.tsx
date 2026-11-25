import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { EditorExtension } from '@meowdown/core'
import { useEditor, useExtension } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { TextSelection } from '@prosekit/pm/state'
import { haptic } from '@/lib/haptics'
import { startBlockDrag, type BlockDrag } from './block-drag'
import { createBlockSelectionCommands, readSelectionState } from './block-selection-commands'
import {
  blockRangeAt,
  createBlockSelectionPlugin,
  hasBlockSelection,
  selectedBlocks,
  setBlockPressGuard,
  withBlockSelection,
} from './block-selection-plugin'
import {
  clearBlockSelection,
  publishBlockSelection,
  type BlockSelectionCommands,
} from './block-selection-store'
import {
  classifyBlockSwipe,
  isHorizontalDrag,
  SELECT_DIRECTION,
  selectTravel,
} from './block-swipe-gestures'
import { whenEditorMounted } from './when-editor-mounted'

/** How far a selecting swipe drags the block along before it snaps back. */
const DRAG_FOLLOW_MAX_PX = 56

/** Hold time that turns a still touch into a block selection (before iOS's own text loupe). */
const LONG_PRESS_MS = 380
/**
 * From here a held finger is heading for a long-press. Early enough that iOS
 * has not latched its text loupe onto the block yet (at 240 ms the loupe
 * showed over the finger once the block was dragged); a tap that outlasts it
 * still lands its caret, because the release lifts the guard first.
 */
const PRESS_GUARD_MS = 100
const PRESS_GUARD_RELEASE_MS = 400

/** Finger travel under which a touch on a selecting editor counts as a tap. */
const TAP_SLOP_PX = 10

/** Finger travel that turns a held block into a dragged one. */
const DRAG_SLOP_PX = 6

/**
 * Craft-style block handling on touch.
 *
 * The gutter grip that reorders blocks is pointer-only, so `NoteEditor` pins
 * it off on the touch surface. Craft's answer is the sideways swipe: drag a
 * block left and it is selected as a whole block (it follows the finger a
 * little, then snaps back highlighted), with the action bar taking the tab
 * bar's place; drag right to complete a task or nest the block under the one
 * above. While blocks are selected the keyboard stays down and a tap on any
 * block adds it to the selection or drops it.
 *
 * Reordering is the hold: keep a finger on a block and it is selected, keep
 * it down and move, and the selected blocks lift and follow the finger to
 * another place in the note ({@link startBlockDrag}).
 *
 * On the daily carousel with the keyboard down, horizontal drags belong to
 * the day swipe, so the block swipe waits for the editor to have focus.
 *
 * The handler is deliberately reluctant. It claims a gesture only once the
 * drag is clearly horizontal ({@link isHorizontalDrag}), acts only when it
 * travels far enough ({@link classifyBlockSwipe}), and never touches a
 * multi-touch gesture. Everything else stays the browser's, because a swipe
 * that steals scrolling is worse than no swipe.
 *
 * Mounted as a `NoteEditor` child so it lives inside the ProseKit context for
 * the editor session and detaches with it.
 */
export function BlockSwipeGestures({
  onAskAi,
}: {
  /** Opens the AI menu over the editor's text selection; false when it can't. */
  onAskAi?: () => boolean
} = {}): ReactElement | null {
  const editor = useEditor<EditorExtension>()
  const askAiRef = useRef(onAskAi)
  askAiRef.current = onAskAi
  const [owner] = useState(() => Symbol('block-selection'))
  const commandsRef = useRef<BlockSelectionCommands | null>(null)

  useExtension(
    useMemo(
      () =>
        definePlugin(
          createBlockSelectionPlugin({
            onChange: (state) => {
              const commands = commandsRef.current
              if (!hasBlockSelection(state) || commands === null) {
                clearBlockSelection(owner)
                return
              }
              publishBlockSelection(owner, { state: readSelectionState(state), commands })
            },
          }),
        ),
      [owner],
    ),
  )

  useLayoutEffect(() => {
    let cleanup: (() => void) | null = null
    const cancelMount = whenEditorMounted(editor, () => {
      const view = editor.view
      const dom = view.dom

      const commands = createBlockSelectionCommands(editor, () => askAiRef.current?.())
      commandsRef.current = commands

      let startX: number | null = null
      let startY: number | null = null
      let startPosition: number | null = null
      let claimed = false
      // The block follows the finger through a paused Web Animation, never
      // an inline style: ProseMirror redraws a node whose attributes change,
      // which would detach the touch target mid-gesture.
      let follow: Animation | null = null
      let swept = 0
      let pressTimer: ReturnType<typeof setTimeout> | null = null
      let guardTimer: ReturnType<typeof setTimeout> | null = null
      let pressed = false
      let drag: BlockDrag | null = null
      // iOS runs its own hold gesture on editable text (~500 ms: caret,
      // loupe, word selection, keyboard). A finger still down after a tap's
      // length makes the editor read-only for the moment (the selection
      // plugin's guard) and turns off text selection on its wrapper, so that
      // gesture finds nothing to act on and our long-press wins. A quick tap
      // never sees it.
      // The whole document, not just this editor: on the daily the hold can
      // land a native selection in the backlinks panel under the editor.
      const guardHost = document.documentElement
      let guarded = false
      const setGuard = (on: boolean): void => {
        if (guarded === on || view.isDestroyed) return
        guarded = on
        guardHost?.classList.toggle('kore-block-press-guard', on)
        view.dispatch(setBlockPressGuard(view.state.tr, on))
      }
      const clearGuard = (delay = 0): void => {
        if (guardTimer !== null) clearTimeout(guardTimer)
        guardTimer = null
        if (delay === 0) setGuard(false)
        else {
          guardTimer = setTimeout(() => {
            guardTimer = null
            setGuard(false)
          }, delay)
        }
      }

      const releaseDrag = (): void => {
        if (follow === null) return
        const animation = follow
        follow = null
        animation.playbackRate = -3
        animation.play()
        animation.onfinish = () => animation.cancel()
      }

      const reset = (): void => {
        startX = null
        startY = null
        startPosition = null
        claimed = false
        swept = 0
        if (pressTimer !== null) clearTimeout(pressTimer)
        pressTimer = null
        releaseDrag()
        drag?.cancel()
        drag = null
      }

      const blockElement = (position: number): HTMLElement | null => {
        const range = blockRangeAt(view.state.doc, position)
        if (range === null) return null
        const node = view.nodeDOM(range.from)
        return node instanceof HTMLElement ? node : null
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
            : (view.posAtCoords({ left: touch.clientX, top: touch.clientY })?.pos ?? null)
        claimed = false
        pressed = false
        // Hold still on a block to select it (no keyboard needed, and it
        // works on the daily, where sideways drags turn the day).
        if (pressTimer !== null) clearTimeout(pressTimer)
        if (!view.hasFocus() && startPosition !== null) {
          const anchor = startPosition
          clearGuard()
          guardTimer = setTimeout(() => {
            guardTimer = null
            setGuard(true)
          }, PRESS_GUARD_MS)
          pressTimer = setTimeout(() => {
            pressTimer = null
            pressed = true
            window.getSelection()?.removeAllRanges()
            view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor }))
          }, LONG_PRESS_MS)
        }
      }

      const swipeAllowed = (): boolean =>
        hasBlockSelection(view.state) ||
        view.hasFocus() ||
        dom.closest('[data-day-carousel]') === null

      const onTouchMove = (event: TouchEvent): void => {
        if (startX === null || startY === null) return
        if (event.touches.length !== 1) {
          reset()
          return
        }
        const touch = event.touches[0]
        if (touch === undefined) return
        const deltaX = touch.clientX - startX
        if (pressTimer !== null && Math.hypot(deltaX, touch.clientY - startY) > TAP_SLOP_PX) {
          clearTimeout(pressTimer)
          pressTimer = null
          clearGuard()
        }
        if (pressed) {
          // A held block that moves is being dragged to another place.
          if (event.cancelable) event.preventDefault()
          if (drag === null && Math.hypot(deltaX, touch.clientY - startY) > DRAG_SLOP_PX) {
            drag = startBlockDrag(view, startY, () => haptic('snap'))
            if (drag !== null) haptic('lift')
          }
          drag?.move(touch.clientX, touch.clientY)
          return
        }
        if (!claimed && swipeAllowed() && isHorizontalDrag(deltaX, touch.clientY - startY)) {
          claimed = true
          const element =
            selectTravel(deltaX) > 0 && startPosition !== null ? blockElement(startPosition) : null
          if (element !== null && typeof element.animate === 'function') {
            follow = element.animate(
              [
                { transform: 'translateX(0)' },
                {
                  transform: `translateX(${SELECT_DIRECTION * DRAG_FOLLOW_MAX_PX}px)`,
                },
              ],
              { duration: 1000, fill: 'both', easing: 'linear' },
            )
            follow.pause()
          }
        }
        if (claimed && event.cancelable) {
          // Only once the gesture is ours: cancelling earlier would kill the
          // page scroll for every touch that starts on the editor.
          event.preventDefault()
        }
        // Keep the finger down after a selecting swipe and slide it over the
        // blocks below or above: each one it crosses joins the selection.
        if (claimed && selectTravel(deltaX) > 24 && Math.abs(touch.clientY - startY) > 12) {
          const over = view.posAtCoords({ left: touch.clientX, top: touch.clientY })?.pos
          if (over !== undefined) {
            const range = blockRangeAt(view.state.doc, over)
            const chosen = new Set(selectedBlocks(view.state).map((block) => block.from))
            if (range !== null && !chosen.has(range.from)) {
              if (swept === 0 && startPosition !== null) {
                if (view.hasFocus()) editor.blur()
                view.dispatch(
                  withBlockSelection(view.state.tr, { type: 'add', anchor: startPosition }),
                )
              }
              swept += 1
              view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor: over }))
            }
          }
        }
        if (claimed && follow !== null) {
          const reach = DRAG_FOLLOW_MAX_PX
          const travel = Math.max(0, Math.min(selectTravel(deltaX) * 0.6, reach))
          follow.currentTime = (travel / reach) * 1000
        }
      }

      const onTouchCancel = (): void => {
        const held = pressed
        pressed = false
        reset()
        clearGuard(held ? PRESS_GUARD_RELEASE_MS : 0)
      }

      const onTouchEnd = (event: TouchEvent): void => {
        const touch = event.changedTouches[0]
        if (startX === null || startY === null || touch === undefined) {
          reset()
          return
        }
        const deltaX = touch.clientX - startX
        const deltaY = touch.clientY - startY
        const position = startPosition

        // The long-press already selected; swallow the release so no caret
        // lands, and keep the guard a beat longer than iOS's own hold timer.
        if (pressed) {
          pressed = false
          drag?.drop()
          drag = null
          reset()
          if (event.cancelable) event.preventDefault()
          window.getSelection()?.removeAllRanges()
          clearGuard(PRESS_GUARD_RELEASE_MS)
          return
        }
        clearGuard()

        // A tap while selecting adds or drops the block under it, and must
        // not land a caret (which would raise the keyboard).
        if (!claimed && hasBlockSelection(view.state)) {
          reset()
          if (Math.hypot(deltaX, deltaY) <= TAP_SLOP_PX && position !== null) {
            if (event.cancelable) event.preventDefault()
            view.dispatch(withBlockSelection(view.state.tr, { type: 'toggle', anchor: position }))
          }
          return
        }
        if (!claimed) {
          reset()
          return
        }
        // A claimed swipe never becomes a tap: no click, no caret.
        if (event.cancelable) event.preventDefault()
        const swipe = classifyBlockSwipe(deltaX, deltaY)
        const sweptAny = swept > 0
        reset()
        // A sweep already selected its blocks as it went.
        if (sweptAny) return
        if (swipe === null || position === null) return

        if (swipe === 'select') {
          // Swipe left: select the block as a block.
          if (view.hasFocus()) editor.blur()
          view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor: position }))
          return
        }
        // Swipe right, the quick action: a task completes (or reopens), any
        // other block steps in one level, under the block above it.
        const range = blockRangeAt(view.state.doc, position)
        if (range !== null && range.node.type.name === 'list') {
          const attrs = range.node.attrs as { kind?: string; checked?: boolean | null }
          if (attrs.kind === 'task') {
            view.dispatch(
              view.state.tr.setNodeMarkup(range.from, undefined, {
                ...range.node.attrs,
                checked: attrs.checked !== true,
              }),
            )
            return
          }
        }
        const bounded = Math.min(Math.max(position, 0), view.state.doc.content.size)
        view.dispatch(
          view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(bounded))),
        )
        editor.commands.indentList()
      }

      // Not passive: a committed swipe must be able to cancel the scroll, and
      // a selecting tap must be able to cancel the caret.
      dom.addEventListener('touchstart', onTouchStart, { passive: true })
      // Move and end on the window: a block the gesture redraws (selection
      // tint) must not strand the rest of the touch.
      window.addEventListener('touchmove', onTouchMove, { passive: false })
      window.addEventListener('touchend', onTouchEnd, { passive: false })
      window.addEventListener('touchcancel', onTouchCancel, { passive: true })
      cleanup = () => {
        dom.removeEventListener('touchstart', onTouchStart)
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('touchend', onTouchEnd)
        window.removeEventListener('touchcancel', onTouchCancel)
        drag?.cancel()
        clearGuard()
      }
    })
    return () => {
      cancelMount()
      cleanup?.()
      commandsRef.current = null
      clearBlockSelection(owner)
    }
  }, [editor, owner])

  return null
}
