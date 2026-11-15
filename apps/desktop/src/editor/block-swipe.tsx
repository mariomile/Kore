import { useLayoutEffect, useMemo, useRef, type ReactElement } from 'react'
import { docToMarkdown, type EditorExtension } from '@meowdown/core'
import { createNoteWithTitle, errorMessage, planSubPage, subPagePreview } from '@kore/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
import { startOperation } from '@/lib/operations'
import { deliverPagePreview } from './page-card-plugin'
import { useEditor, useExtension } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { TextSelection, type EditorState } from '@prosekit/pm/state'
import { addDays, format } from 'date-fns'
import { setBlockKind } from './block-kind'
import { zoomIntoBlockAt } from './block-zoom-plugin'
import { openMoveBranch } from './move-branch-opener'
import {
  blockRangeAt,
  createBlockSelectionPlugin,
  hasBlockSelection,
  selectedBlocks,
  setBlockPressGuard,
  withBlockSelection,
  type BlockRange,
} from './block-selection-plugin'
import {
  clearBlockSelection,
  publishBlockSelection,
  type BlockReminder,
  type BlockSelectionCommands,
  type BlockSelectionState,
} from './block-selection-store'
import type { FormattingBlockKind } from './formatting-toolbar-store'
import { classifyBlockSwipe, isHorizontalDrag } from './block-swipe-gestures'
import { whenEditorMounted } from './when-editor-mounted'

/** How far a selecting swipe drags the block along before it snaps back. */
const DRAG_FOLLOW_MAX_PX = 56

/** Hold time that turns a still touch into a block selection (before iOS's own text loupe). */
const LONG_PRESS_MS = 380
/** Past a tap's length: from here a held finger is heading for a long-press. */
const PRESS_GUARD_MS = 240
const PRESS_GUARD_RELEASE_MS = 400

/** Finger travel under which a touch on a selecting editor counts as a tap. */
const TAP_SLOP_PX = 10

function kindOf(range: BlockRange): FormattingBlockKind {
  const name = range.node.type.name
  if (name === 'list') {
    return (range.node.attrs as { kind?: string }).kind === 'task' ? 'task' : 'bullet'
  }
  if (name === 'heading') return 'heading'
  if (name === 'blockquote') return 'quote'
  return 'text'
}

function readSelectionState(state: EditorState): BlockSelectionState {
  const blocks = selectedBlocks(state)
  const kinds = new Set(blocks.map(kindOf))
  const single = blocks.length === 1 ? blocks[0] : undefined
  const siblings = (range: BlockRange): { before: boolean; after: boolean; nested: boolean } => {
    const $pos = state.doc.resolve(range.from)
    const index = $pos.index()
    const parent = $pos.parent
    const prev = index > 0 ? parent.child(index - 1) : null
    const next = index + 1 < parent.childCount ? parent.child(index + 1) : null
    return {
      before: prev?.type.name === 'list',
      after: next?.type.name === 'list',
      nested: parent.type.name === 'list',
    }
  }
  const lists = blocks.filter((block) => block.node.type.name === 'list')
  return {
    count: blocks.length,
    kind: kinds.size === 1 ? ([...kinds][0] ?? null) : null,
    canIndent: lists.length === blocks.length && lists.every((block) => siblings(block).before),
    canOutdent: blocks.some((block) => siblings(block).nested),
    canMoveUp: single !== undefined && single.node.type.name === 'list' && siblings(single).before,
    canMoveDown: single !== undefined && single.node.type.name === 'list' && siblings(single).after,
  }
}

function reminderDate(when: BlockReminder | Date): string {
  if (when instanceof Date) return format(when, 'yyyy-MM-dd')
  const days = when === 'today' ? 0 : when === 'tomorrow' ? 1 : 7
  return format(addDays(new Date(), days), 'yyyy-MM-dd')
}

/**
 * Craft-style block handling on touch.
 *
 * The gutter grip that reorders blocks is pointer-only, so `NoteEditor` pins
 * it off on the touch surface. Craft's answer is the sideways swipe: drag a
 * block right and it is selected as a whole block (it follows the finger a
 * little, then snaps back highlighted), with the action bar taking the tab
 * bar's place; drag left to outdent. While blocks are selected the keyboard
 * stays down and a tap on any block adds it to the selection or drops it.
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
  generation = null,
  openPage,
}: {
  /** Opens the AI menu over the editor's text selection; false when it can't. */
  onAskAi?: () => boolean
  /** The vault generation new sub pages are written under; null leaves Page off. */
  generation?: number | null
  /** Opens a page by its link target (the confirmation's "Open"). */
  openPage?: (target: string) => void
} = {}): ReactElement | null {
  const editor = useEditor<EditorExtension>()
  const askAiRef = useRef(onAskAi)
  askAiRef.current = onAskAi
  const pageRef = useRef({ generation, openPage })
  pageRef.current = { generation, openPage }
  const owner = useMemo(() => Symbol('block-selection'), [])
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

      /** Run `step` with the caret inside each selected block, last block first. */
      const eachBlock = (step: () => void): void => {
        const blocks = selectedBlocks(view.state).reverse()
        for (const block of blocks) {
          const near = TextSelection.near(view.state.doc.resolve(block.from + 1), 1)
          view.dispatch(view.state.tr.setSelection(near))
          step()
        }
        // The caret moved for the commands' sake; the keyboard stays down.
        if (view.hasFocus()) editor.blur()
      }

      const commands: BlockSelectionCommands = {
        setKind: (kind) => eachBlock(() => setBlockKind(editor, kind)),
        remind: (when) => {
          const date = reminderDate(when)
          eachBlock(() => {
            setBlockKind(editor, 'task')
            const { $from } = view.state.selection
            const end = $from.end()
            const text = $from.parent.textContent
            // A block that already has a date gets the new one in its place.
            const existing = /\[\[\d{4}-\d{2}-\d{2}\]\]/.exec(text)
            if (existing !== null) {
              const from = $from.start() + existing.index
              view.dispatch(
                view.state.tr.insertText(`[[${date}]]`, from, from + existing[0].length),
              )
              return
            }
            const lead = text.length > 0 && !text.endsWith(' ') ? ' ' : ''
            view.dispatch(view.state.tr.insertText(`${lead}[[${date}]]`, end))
          })
        },
        indent: () => eachBlock(() => editor.commands.indentList()),
        outdent: () => eachBlock(() => editor.commands.dedentList()),
        moveUp: () => eachBlock(() => editor.commands.moveList('up')),
        moveDown: () => eachBlock(() => editor.commands.moveList('down')),
        duplicate: () => {
          const blocks = selectedBlocks(view.state).reverse()
          let tr = view.state.tr
          for (const block of blocks) tr = tr.insert(block.to, block.node.copy(block.node.content))
          view.dispatch(tr)
        },
        copy: async () => {
          const blocks = selectedBlocks(view.state)
          const doc = view.state.schema.topNodeType.create(
            null,
            blocks.map((block) => block.node),
          )
          await navigator.clipboard.writeText(docToMarkdown(doc).trim())
        },
        remove: () => {
          const blocks = selectedBlocks(view.state).reverse()
          let tr = view.state.tr
          for (const block of blocks) tr = tr.delete(block.from, block.to)
          view.dispatch(withBlockSelection(tr, { type: 'clear' }))
        },
        zoom: () => {
          const first = selectedBlocks(view.state)[0]
          if (first === undefined) return
          view.dispatch(withBlockSelection(view.state.tr, { type: 'clear' }))
          zoomIntoBlockAt(view, first.from)
        },
        makePage: () => {
          const blocks = selectedBlocks(view.state)
          const block = blocks[0]
          const { generation: current, openPage: open } = pageRef.current
          if (block === undefined || blocks.length !== 1) return
          const fail = (why: string): void => {
            startOperation('Turning into a page').fail(why)
          }
          if (current === null) {
            fail('This note is not in a vault yet.')
            return
          }
          const { node } = block
          const isList = node.type.name === 'list'
          const head = isList ? node.firstChild : node
          const rest: ProseMirrorNode[] = []
          if (isList) node.forEach((child, _offset, index) => index > 0 && rest.push(child))
          const childrenMarkdown =
            rest.length === 0 ? '' : docToMarkdown(view.state.schema.topNodeType.create(null, rest))
          const plan = planSubPage(head?.textContent ?? '', childrenMarkdown)
          if (plan === null) {
            fail('Write a line for the page title first.')
            return
          }
          view.dispatch(withBlockSelection(view.state.tr, { type: 'clear' }))
          void createNoteWithTitle(plan.title, current, plan.body === '' ? undefined : plan.body)
            .then(() => {
              const now = view.state.doc.nodeAt(block.from)
              const done = startOperation(
                `Made page ${plan.title}`,
                open === undefined
                  ? {}
                  : { action: { label: 'Open', run: () => open(plan.title) } },
              )
              if (view.isDestroyed || now === null || !now.eq(node)) {
                done.warn('The note changed meanwhile, so the block stayed where it was.')
                return
              }
              deliverPagePreview(view, plan.title, {
                title: plan.title,
                excerpt: subPagePreview(plan.body),
                missing: false,
              })
              const { schema } = view.state
              const paragraph = schema.nodes.paragraph
              if (paragraph === undefined) {
                done.fail('This editor has no paragraphs.')
                return
              }
              view.dispatch(
                view.state.tr.replaceWith(
                  block.from,
                  block.to,
                  paragraph.create(null, schema.text(plan.link)),
                ),
              )
              done.done()
            })
            .catch((cause: unknown) => fail(errorMessage(cause)))
        },
        moveToNote: () => {
          const first = selectedBlocks(view.state)[0]
          if (first === undefined) return
          view.dispatch(withBlockSelection(view.state.tr, { type: 'clear' }))
          openMoveBranch(view, first.from + 1)
        },
        askAi: () => {
          const blocks = selectedBlocks(view.state)
          const first = blocks[0]
          const last = blocks[blocks.length - 1]
          if (first === undefined || last === undefined) return
          const selection = TextSelection.between(
            view.state.doc.resolve(first.from + 1),
            view.state.doc.resolve(last.to - 1),
          )
          view.dispatch(
            withBlockSelection(view.state.tr.setSelection(selection), { type: 'clear' }),
          )
          view.focus()
          askAiRef.current?.()
        },
        clear: () => view.dispatch(withBlockSelection(view.state.tr, { type: 'clear' })),
      }
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
      // iOS runs its own hold gesture on editable text (~500 ms: caret,
      // loupe, word selection, keyboard). A finger still down after a tap's
      // length makes the editor read-only for the moment (the selection
      // plugin's guard) and turns off text selection on its wrapper, so that
      // gesture finds nothing to act on and our long-press wins. A quick tap
      // never sees it.
      const guardHost = dom.parentElement
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
        else setTimeout(() => setGuard(false), delay)
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
        if (pressed && event.cancelable) event.preventDefault()
        if (!claimed && swipeAllowed() && isHorizontalDrag(deltaX, touch.clientY - startY)) {
          claimed = true
          const element = deltaX > 0 && startPosition !== null ? blockElement(startPosition) : null
          if (element !== null && typeof element.animate === 'function') {
            follow = element.animate(
              [
                { transform: 'translateX(0)' },
                {
                  transform: `translateX(${DRAG_FOLLOW_MAX_PX}px)`,
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
        if (claimed && deltaX > 24 && Math.abs(touch.clientY - startY) > 12) {
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
          const travel = Math.max(0, Math.min(deltaX * 0.6, reach))
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

        if (swipe === 'indent') {
          // Swipe right: select the block as a block (Craft).
          if (view.hasFocus()) editor.blur()
          view.dispatch(withBlockSelection(view.state.tr, { type: 'add', anchor: position }))
          return
        }
        // Swipe left, the quick action: a task completes (or reopens), any
        // other block steps out one level.
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
        editor.commands.dedentList()
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
