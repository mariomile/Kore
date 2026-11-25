import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { EditorExtension } from '@meowdown/core'
import { useEditor, useExtension } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { hapticImpactLight } from '@/mobile/haptics'
import { startBlockDrag, type BlockDrag } from './block-drag'
import {
  createBlockSelectionCommands,
  readSelectionState,
  runSwipeAction,
} from './block-selection-commands'
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
  FOLLOW_MAX_PX,
  followOffset,
  isCommitted,
  isHorizontalDrag,
  swipeIntent,
  SWEEP_START_PX,
  type BlockSwipe,
} from './block-swipe-gestures'
import { slideBack } from './block-drag-motion'
import { whenEditorMounted } from './when-editor-mounted'

/** Hold time that turns a still touch into a block selection (before iOS's own text loupe). */
const LONG_PRESS_MS = 380
/**
 * Hold time on a block that is already selected: it is waiting to be moved,
 * so the drag picks it up sooner.
 */
const LONG_PRESS_SELECTED_MS = 200
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
 * block left and it follows the finger; past the commit point it ticks and
 * shows selected at once, and on release it springs back into line, with
 * the action bar taking the tab bar's place. Drag right to complete a task
 * or nest the block under the one above. While blocks are selected the
 * keyboard stays down and a tap on any block adds it to the selection or
 * drops it.
 *
 * Reordering is the hold: keep a finger on a block and it is selected, keep
 * it down and move, and the selected blocks lift and follow the finger to
 * another place in the note ({@link startBlockDrag}).
 *
 * On the daily carousel with the keyboard down, horizontal drags belong to
 * the day swipe, so the block swipe waits for the editor to have focus.
 *
 * The handler is deliberately reluctant. It claims a gesture only once the
 * drag is clearly horizontal ({@link isHorizontalDrag}) and before the page
 * has started scrolling, acts only when it travels far enough
 * ({@link isCommitted}), and never touches a multi-touch gesture. Everything
 * else stays the browser's, because a swipe that steals scrolling is worse
 * than no swipe.
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
      // The swiped block follows the finger through a paused Web Animation,
      // never an inline style: ProseMirror redraws a node whose attributes
      // change, which would detach the touch target mid-gesture.
      let follow: Animation | null = null
      let followed: HTMLElement | null = null
      let offset = 0
      // The start block's box, which a sweep has to leave before it takes
      // another block.
      let startBox: DOMRect | null = null
      // What the swipe would do if let go now; null below the commit point.
      let committed: BlockSwipe | null = null
      // The start block was selected before this swipe (it stays selected).
      let wasSelected = false
      // A committed select already shows its block as selected.
      let selectShown = false
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

      const releaseFollow = (): void => {
        follow?.cancel()
        if (followed !== null) slideBack(followed, offset)
        follow = null
        followed = null
        offset = 0
      }

      const reset = (): void => {
        startX = null
        startY = null
        startPosition = null
        claimed = false
        startBox = null
        committed = null
        wasSelected = false
        selectShown = false
        swept = 0
        if (pressTimer !== null) clearTimeout(pressTimer)
        pressTimer = null
        releaseFollow()
        drag?.cancel()
        drag = null
      }

      const blockElement = (position: number): HTMLElement | null => {
        const range = blockRangeAt(view.state.doc, position)
        if (range === null) return null
        const node = view.nodeDOM(range.from)
        return node instanceof HTMLElement ? node : null
      }

      const isSelectedAt = (position: number): boolean => {
        const from = blockRangeAt(view.state.doc, position)?.from
        return selectedBlocks(view.state).some((block) => block.from === from)
      }

      const selectStart = (): void => {
        if (startPosition === null) return
        if (view.hasFocus()) editor.blur()
        view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor: startPosition }))
      }

      /**
       * The swipe crossed its commit point, either way: a tick, and a select
       * shows its block selected at once (Craft's way) unless the keyboard
       * is up, where dropping it mid-gesture would shift the note under the
       * finger; that select lands on release.
       */
      const setCommitted = (next: BlockSwipe | null): void => {
        if (next === committed) return
        if (committed === 'select' && selectShown && !wasSelected && startPosition !== null) {
          view.dispatch(
            withBlockSelection(view.state.tr, { type: 'toggle', anchor: startPosition }),
          )
        }
        selectShown = false
        committed = next
        if (next === null) return
        hapticImpactLight()
        if (next === 'select' && !view.hasFocus()) {
          if (!wasSelected) selectStart()
          selectShown = true
        }
      }

      const onTouchStart = (event: TouchEvent): void => {
        if (event.touches.length !== 1) {
          reset()
          return
        }
        reset()
        const touch = event.touches[0]
        startX = touch?.clientX ?? null
        startY = touch?.clientY ?? null
        startPosition =
          touch === undefined
            ? null
            : (view.posAtCoords({ left: touch.clientX, top: touch.clientY })?.pos ?? null)
        pressed = false
        // Hold still on a block to select it (no keyboard needed, and it
        // works on the daily, where sideways drags turn the day).
        if (!view.hasFocus() && startPosition !== null) {
          const anchor = startPosition
          clearGuard()
          guardTimer = setTimeout(() => {
            guardTimer = null
            setGuard(true)
          }, PRESS_GUARD_MS)
          pressTimer = setTimeout(
            () => {
              pressTimer = null
              pressed = true
              window.getSelection()?.removeAllRanges()
              view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor }))
            },
            isSelectedAt(anchor) ? LONG_PRESS_SELECTED_MS : LONG_PRESS_MS,
          )
        }
      }

      const swipeAllowed = (): boolean =>
        hasBlockSelection(view.state) ||
        view.hasFocus() ||
        dom.closest('[data-day-carousel]') === null

      /** Claim the drag as a swipe on the block under its start. */
      const claim = (): void => {
        claimed = true
        followed = startPosition === null ? null : blockElement(startPosition)
        startBox = followed?.getBoundingClientRect() ?? null
        wasSelected = startPosition !== null && isSelectedAt(startPosition)
        if (followed !== null && typeof followed.animate === 'function') {
          follow = followed.animate(
            [
              { transform: `translateX(${-FOLLOW_MAX_PX}px)` },
              { transform: `translateX(${FOLLOW_MAX_PX}px)` },
            ],
            { duration: 1000, fill: 'both', easing: 'linear' },
          )
          follow.pause()
          follow.currentTime = 500
        }
      }

      /**
       * Keep the finger down after a selecting swipe and slide it over the
       * blocks below or above: each one it crosses joins the selection. Only
       * once the finger has left its own block, so a swipe on a short line
       * that drifts never takes the next one with it.
       */
      const sweep = (x: number, y: number, deltaY: number): void => {
        if (Math.abs(deltaY) <= SWEEP_START_PX) return
        if (startBox !== null && y >= startBox.top && y <= startBox.bottom) return
        const over = view.posAtCoords({ left: x, top: y })?.pos
        if (over === undefined || isSelectedAt(over)) return
        if (swept === 0 && !selectShown && !wasSelected) selectStart()
        selectShown = true
        swept += 1
        hapticImpactLight()
        view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor: over }))
      }

      const onTouchMove = (event: TouchEvent): void => {
        if (startX === null || startY === null) return
        if (event.touches.length !== 1) {
          reset()
          return
        }
        const touch = event.touches[0]
        if (touch === undefined) return
        const deltaX = touch.clientX - startX
        const deltaY = touch.clientY - startY
        if (pressTimer !== null && Math.hypot(deltaX, deltaY) > TAP_SLOP_PX) {
          clearTimeout(pressTimer)
          pressTimer = null
          clearGuard()
        }
        if (pressed) {
          // A held block that moves is being dragged to another place.
          if (event.cancelable) event.preventDefault()
          if (drag === null && Math.hypot(deltaX, deltaY) > DRAG_SLOP_PX) {
            drag = startBlockDrag(view, startY, hapticImpactLight)
            if (drag !== null) hapticImpactLight()
          }
          drag?.move(touch.clientX, touch.clientY)
          return
        }
        if (!claimed) {
          if (!swipeAllowed() || !isHorizontalDrag(deltaX, deltaY)) return
          // The page already scrolls: the gesture is the scroll's for good.
          // Half a swipe on top of a scroll is what made it feel loose.
          if (!event.cancelable) {
            startX = null
            startY = null
            return
          }
          claim()
        }
        // Ours now: the page stays put, whichever way the finger drifts.
        if (event.cancelable) event.preventDefault()
        if (swept === 0) {
          setCommitted(
            isCommitted(deltaX, committed === swipeIntent(deltaX)) ? swipeIntent(deltaX) : null,
          )
          offset = followOffset(deltaX)
          if (follow !== null) follow.currentTime = ((offset + FOLLOW_MAX_PX) / FOLLOW_MAX_PX) * 500
        }
        if (committed === 'select') sweep(touch.clientX, touch.clientY, deltaY)
      }

      const onTouchCancel = (): void => {
        const held = pressed
        pressed = false
        // A cancelled swipe takes back the selection it showed.
        if (claimed && swept === 0) setCommitted(null)
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
        const swipe = committed
        const shown = selectShown || swept > 0
        reset()
        if (swipe === null || position === null) return

        if (swipe === 'select') {
          // Swipe left: the block is selected as a block (already, unless
          // the keyboard was up).
          if (!shown) {
            if (view.hasFocus()) editor.blur()
            view.dispatch(
              withBlockSelection(view.state.tr, {
                type: 'add',
                anchor: position,
              }),
            )
          }
          return
        }
        // Swipe right, the quick action.
        runSwipeAction(editor, position)
      }

      // While a block is held, dragged or selected, iOS must not start its
      // own drag of the text under the finger: it took over Kore's drag
      // (a ghost of the text with a count badge) and dropped a copy.
      const onDragStart = (event: DragEvent): void => {
        if (pressed || drag !== null || hasBlockSelection(view.state)) event.preventDefault()
      }

      // Not passive: a committed swipe must be able to cancel the scroll, and
      // a selecting tap must be able to cancel the caret.
      dom.addEventListener('touchstart', onTouchStart, { passive: true })
      // Move and end on the window: a block the gesture redraws (selection
      // tint) must not strand the rest of the touch.
      window.addEventListener('touchmove', onTouchMove, { passive: false })
      window.addEventListener('touchend', onTouchEnd, { passive: false })
      window.addEventListener('touchcancel', onTouchCancel, { passive: true })
      window.addEventListener('dragstart', onDragStart, { capture: true })
      cleanup = () => {
        dom.removeEventListener('touchstart', onTouchStart)
        window.removeEventListener('touchmove', onTouchMove)
        window.removeEventListener('touchend', onTouchEnd)
        window.removeEventListener('touchcancel', onTouchCancel)
        window.removeEventListener('dragstart', onDragStart, { capture: true })
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
