import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useEditor } from '@meowdown/react'
import type { EditorExtension, TypedEditor } from '@meowdown/core'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Checklist,
  Copy,
  ArrowUturnRight,
  Link,
  List,
  Locate,
  MoreHorizontal,
  Sparkles,
  Trash,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { canLinkToBlock } from './block-id-plugin'
import { canZoom, zoomIntoBlockAt } from './block-zoom-plugin'
import { copyLinkToBlock } from './copy-block-link'
import { canMoveBranch } from './move-branch-picker'
import { openMoveBranch } from './move-branch-opener'
import { whenEditorMounted } from './when-editor-mounted'
import { copySliceWithoutLineIds, turnIntoPage, unmarkPage } from './page-block-commands'
import { pageBlockOf } from './page-block-plugin'
import { startOperation } from '@/lib/operations'

const HANDLE_CLICK_PX = 5

interface BlockActionState {
  readonly count: number
  readonly from: number
  readonly to: number
  readonly hasText: boolean
  readonly canCycleList: boolean
  readonly canCycleChecklist: boolean
  readonly canIndent: boolean
  readonly canDedent: boolean
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
}

interface SelectedBlockRange {
  readonly count: number
  readonly from: number
  readonly to: number
}

interface HandleMenu {
  readonly anchor: { getBoundingClientRect: () => DOMRect }
  readonly state: BlockActionState
}

function selectionType(selection: { toJSON(): unknown }): unknown {
  const json = selection.toJSON()
  return typeof json === 'object' && json !== null && 'type' in json ? json.type : undefined
}

function selectedNodeRange(editor: TypedEditor): SelectedBlockRange | null {
  const { selection } = editor.state
  return selectionType(selection) === 'node'
    ? { count: 1, from: selection.from, to: selection.to }
    : null
}

function topLevelBlockAtCursor(editor: TypedEditor): SelectedBlockRange | null {
  const { $from, $to } = editor.state.selection
  if ($from.pos !== $to.pos && $from.depth === 0) {
    return null
  }
  if ($from.depth === 0) {
    const index = $from.index()
    if (index >= editor.state.doc.childCount) {
      return null
    }
    const node = editor.state.doc.child(index)
    const from = $from.posAtIndex(index)
    return { count: 1, from, to: from + node.nodeSize }
  }
  const from = $from.before(1)
  const node = $from.node(1)
  return { count: 1, from, to: from + node.nodeSize }
}

function selectedBlockRange(editor: TypedEditor): SelectedBlockRange | null {
  const { doc, selection } = editor.state
  const type = selectionType(selection)

  // A node selection is the grip's job: clicking the handle opens the block
  // menu. The bottom toolbar is only for a selection that spans blocks.
  if (type === 'node' || selection.empty) {
    return null
  }

  const blocks: Array<{ from: number; to: number }> = []
  doc.forEach((node, offset) => {
    const nodeEnd = offset + node.nodeSize
    if (selection.from < nodeEnd && selection.to > offset) {
      blocks.push({ from: offset, to: nodeEnd })
    }
  })

  // A text selection inside one block belongs to the inline-selection menu.
  // Crossing block boundaries is the unambiguous multi-block gesture.
  if (blocks.length < 2 && type !== 'all') {
    return null
  }
  const first = blocks[0]
  const last = blocks.at(-1)
  return first === undefined || last === undefined
    ? null
    : { count: blocks.length, from: first.from, to: last.to }
}

function capabilitiesForRange(editor: TypedEditor, range: SelectedBlockRange): BlockActionState {
  return {
    ...range,
    hasText: editor.state.doc.textBetween(range.from, range.to, '\n').trim() !== '',
    canCycleList: editor.commands.cycleBulletOrderedList.canExec(),
    canCycleChecklist: editor.commands.cycleCheckableList.canExec(),
    canIndent: editor.commands.indentList.canExec(),
    canDedent: editor.commands.dedentList.canExec(),
    canMoveUp: editor.commands.moveList.canExec('up'),
    canMoveDown: editor.commands.moveList.canExec('down'),
  }
}

function readBlockActionState(editor: TypedEditor): BlockActionState | null {
  const range = selectedBlockRange(editor)
  return range === null ? null : capabilitiesForRange(editor, range)
}

function readHandleBlockState(editor: TypedEditor): BlockActionState | null {
  const range = selectedNodeRange(editor) ?? topLevelBlockAtCursor(editor)
  return range === null ? null : capabilitiesForRange(editor, range)
}

function statesEqual(left: BlockActionState | null, right: BlockActionState | null): boolean {
  if (left === right) {
    return true
  }
  if (left === null || right === null) {
    return false
  }
  return (
    left.count === right.count &&
    left.from === right.from &&
    left.to === right.to &&
    left.hasText === right.hasText &&
    left.canCycleList === right.canCycleList &&
    left.canCycleChecklist === right.canCycleChecklist &&
    left.canIndent === right.canIndent &&
    left.canDedent === right.canDedent &&
    left.canMoveUp === right.canMoveUp &&
    left.canMoveDown === right.canMoveDown
  )
}

function editorHostRoot(editor: TypedEditor): Element | null {
  return editor.mounted ? editor.view.dom.closest('.meowdown') : null
}

function closestBlockHandle(
  target: EventTarget | null,
  editorRoot: Element | null,
): HTMLElement | null {
  if (!(target instanceof Element) || editorRoot === null) {
    return null
  }
  const handle = target.closest('[data-testid="block-handle-drag"], [data-testid="block-handle"]')
  if (!(handle instanceof HTMLElement) || !editorRoot.contains(handle)) {
    return null
  }
  return handle
}

function snapshotAnchor(element: HTMLElement): HandleMenu['anchor'] {
  const rect = element.getBoundingClientRect()
  return { getBoundingClientRect: () => new DOMRect(rect.x, rect.y, rect.width, rect.height) }
}

interface BlockActionToolbarProps {
  /** Whether this note may send its selected content to the configured AI provider. */
  aiEnabled: boolean
  /** Open Meowdown's existing selection-prompt menu over the current selection. */
  onOpenAi: () => void
}

interface BlockActionMenuItemsProps {
  readonly aiEnabled: boolean
  readonly editor: TypedEditor
  readonly onOpenAi: () => void
  readonly onRan: () => void
  readonly state: BlockActionState
}

function duplicateRange(editor: TypedEditor, state: BlockActionState): void {
  const { doc, schema } = editor.state
  const slice = doc.slice(state.from, state.to)
  // Whole blocks copy without their line ids (a page gets a fresh one), so a
  // duplicate never steals a link; a partial slice copies as it is.
  const tr =
    slice.openStart === 0 && slice.openEnd === 0
      ? editor.state.tr.insert(state.to, copySliceWithoutLineIds(slice, schema, doc))
      : editor.state.tr.replaceRange(state.to, state.to, slice)
  editor.view.dispatch(tr.scrollIntoView())
}

/** Whether the block the menu acts on is a sub page. */
function isPageAt(editor: TypedEditor, state: BlockActionState): boolean {
  const node = editor.state.doc.nodeAt(state.from)
  return state.count === 1 && node !== null && pageBlockOf(node, state.from) !== null
}

function deleteRange(editor: TypedEditor, state: BlockActionState): void {
  editor.view.dispatch(editor.state.tr.delete(state.from, state.to).scrollIntoView())
}

function BlockActionMenuItems({
  aiEnabled,
  editor,
  onOpenAi,
  onRan,
  state,
}: BlockActionMenuItemsProps): ReactElement {
  const run = (command: () => void): void => {
    command()
    onRan()
    editor.focus()
  }
  const isPage = isPageAt(editor, state)
  // Any other kind takes a page back to an ordinary block: the marker goes,
  // the children stay where they are (the iPhone's Turn into does the same).
  const turn = (command: () => void): void => {
    run(() => {
      if (isPage) editor.view.dispatch(unmarkPage(editor.state.tr, state.from))
      command()
    })
  }
  return (
    <>
      {aiEnabled && state.hasText ? (
        <DropdownMenuItem
          onClick={() => {
            onOpenAi()
            onRan()
          }}
        >
          <Sparkles aria-hidden />
          Ask AI
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Turn into</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-44">
          <DropdownMenuItem onClick={() => turn(() => editor.commands.turnIntoText())}>
            Text
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => turn(() => editor.commands.setHeading({ level: 1 }))}>
            Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => turn(() => editor.commands.setHeading({ level: 2 }))}>
            Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => turn(() => editor.commands.setHeading({ level: 3 }))}>
            Heading 3
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => turn(() => editor.commands.wrapInList({ kind: 'bullet' }))}
          >
            Bullet list
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => turn(() => editor.commands.wrapInList({ kind: 'ordered' }))}
          >
            Ordered list
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => turn(() => editor.commands.wrapInSquareTask())}>
            {/* One task style everywhere (round box, `- [ ]`), as on the iPhone. */}
            To-do
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => turn(() => editor.commands.setBlockquote())}>
            Quote
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => turn(() => editor.commands.setCodeBlock())}>
            Code
          </DropdownMenuItem>
          {state.count === 1 && !isPage ? (
            <DropdownMenuItem
              onClick={() =>
                run(() => {
                  const why = turnIntoPage(editor, state.from)
                  if (why !== null) startOperation('Turning into a page').fail(why)
                })
              }
            >
              Page
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {state.canCycleList ? (
        <DropdownMenuItem onClick={() => run(() => editor.commands.cycleBulletOrderedList())}>
          <List aria-hidden />
          Change list style
        </DropdownMenuItem>
      ) : null}
      {state.canCycleChecklist ? (
        <DropdownMenuItem onClick={() => run(() => editor.commands.cycleCheckableList())}>
          <Checklist aria-hidden />
          Change checklist style
        </DropdownMenuItem>
      ) : null}
      {state.canDedent ? (
        <DropdownMenuItem onClick={() => run(() => editor.commands.dedentList())}>
          <ArrowLeft aria-hidden />
          Outdent
        </DropdownMenuItem>
      ) : null}
      {state.canIndent ? (
        <DropdownMenuItem onClick={() => run(() => editor.commands.indentList())}>
          <ArrowRight aria-hidden />
          Indent
        </DropdownMenuItem>
      ) : null}
      {state.canMoveUp ? (
        <DropdownMenuItem onClick={() => run(() => editor.commands.moveList('up'))}>
          <ArrowUp aria-hidden />
          Move up
        </DropdownMenuItem>
      ) : null}
      {state.canMoveDown ? (
        <DropdownMenuItem onClick={() => run(() => editor.commands.moveList('down'))}>
          <ArrowDown aria-hidden />
          Move down
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {state.count === 1 && canZoom(editor.state) ? (
        <DropdownMenuItem onClick={() => run(() => zoomIntoBlockAt(editor.view, state.from))}>
          <Locate aria-hidden />
          {isPage ? 'Open page' : 'Zoom in'}
        </DropdownMenuItem>
      ) : null}
      {state.count === 1 && canLinkToBlock(editor.view) ? (
        <DropdownMenuItem onClick={() => run(() => void copyLinkToBlock(editor.view, state.from))}>
          <Link aria-hidden />
          Copy link to line
        </DropdownMenuItem>
      ) : null}
      {state.count === 1 && canMoveBranch(editor.view, state.from) ? (
        <DropdownMenuItem onClick={() => run(() => void openMoveBranch(editor.view, state.from))}>
          <ArrowUturnRight aria-hidden />
          Move to note…
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => run(() => duplicateRange(editor, state))}>
        <Copy aria-hidden />
        Duplicate
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => run(() => deleteRange(editor, state))}>
        <Trash aria-hidden />
        Delete
      </DropdownMenuItem>
    </>
  )
}

/** Grip-click menu plus the multi-block toolbar. */
export function BlockActionToolbar({
  aiEnabled,
  onOpenAi,
}: BlockActionToolbarProps): ReactElement | null {
  const editor = useEditor<EditorExtension>()
  const [state, setState] = useState<BlockActionState | null>(null)
  const [handleMenu, setHandleMenu] = useState<HandleMenu | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const moreMenuOpenRef = useRef(false)
  const interactingWithToolbarRef = useRef(false)
  const scheduleSyncRef = useRef<(() => void) | null>(null)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const dragStarted = useRef(false)
  const openMenuRangeRef = useRef<{ from: number; to: number } | null>(null)
  const gripPressRange = useRef<{ from: number; to: number } | null>(null)
  openMenuRangeRef.current =
    handleMenu === null ? null : { from: handleMenu.state.from, to: handleMenu.state.to }
  moreMenuOpenRef.current = moreMenuOpen

  useLayoutEffect(() => {
    let syncFrame: number | null = null
    let syncTimer: ReturnType<typeof setTimeout> | null = null
    let toolbarInteractionFrame: number | null = null
    let pointerDragging = false

    function isInsideToolbar(target: EventTarget | null): boolean {
      return target instanceof Node && (toolbarRef.current?.contains(target) ?? false)
    }

    function toolbarOwnsInteraction(relatedTarget: EventTarget | null = null): boolean {
      return (
        interactingWithToolbarRef.current ||
        moreMenuOpenRef.current ||
        isInsideToolbar(relatedTarget) ||
        isInsideToolbar(document.activeElement)
      )
    }

    function sync(): void {
      if (!editor.mounted) {
        return
      }
      if (!editor.view.hasFocus()) {
        if (!toolbarOwnsInteraction()) {
          setState((current) => (current === null ? current : null))
        }
        return
      }
      setState((current) => {
        const next = readBlockActionState(editor)
        return statesEqual(current, next) ? current : next
      })
    }

    function cancelScheduled(): void {
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame)
        syncFrame = null
      }
      if (syncTimer !== null) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
    }

    function syncAfterFrame(): void {
      if (pointerDragging || !editor.mounted) {
        return
      }
      cancelScheduled()
      syncFrame = requestAnimationFrame(() => {
        syncFrame = null
        sync()
      })
    }

    scheduleSyncRef.current = syncAfterFrame

    // Keyboard selection moves (e.g. holding Shift+ArrowDown) debounce briefly
    // so we don't run six dry-run ProseMirror transactions on every key repeat.
    function syncDebounced(): void {
      if (pointerDragging || !editor.mounted) {
        return
      }
      if (!editor.view.hasFocus()) {
        if (!toolbarOwnsInteraction()) {
          setState((current) => (current === null ? current : null))
        }
        return
      }
      cancelScheduled()
      syncTimer = setTimeout(() => {
        syncTimer = null
        sync()
      }, 80)
    }

    function onEditorPointerDown(event: PointerEvent): void {
      if (event.button === 0) {
        pointerDragging = true
        cancelScheduled()
      }
    }

    function onEditorBlur(event: FocusEvent): void {
      if (toolbarOwnsInteraction(event.relatedTarget)) {
        return
      }
      cancelScheduled()
      setState((current) => (current === null ? current : null))
    }

    function onWindowPointerEnd(): void {
      if (interactingWithToolbarRef.current) {
        if (toolbarInteractionFrame !== null) {
          cancelAnimationFrame(toolbarInteractionFrame)
        }
        // Release after click dispatch completes (WebKit blurs contenteditable
        // with relatedTarget === null before firing button click).
        toolbarInteractionFrame = requestAnimationFrame(() => {
          toolbarInteractionFrame = null
          interactingWithToolbarRef.current = false
          if (!moreMenuOpenRef.current && editor.mounted && !editor.view.hasFocus()) {
            syncAfterFrame()
          }
        })
      }
      if (!pointerDragging) {
        return
      }
      pointerDragging = false
      syncAfterFrame()
    }

    const cancelMount = whenEditorMounted(editor, () => {
      const dom = editor.view.dom
      document.addEventListener('selectionchange', syncDebounced)
      dom.addEventListener('pointerdown', onEditorPointerDown)
      window.addEventListener('pointerup', onWindowPointerEnd)
      window.addEventListener('pointercancel', onWindowPointerEnd)
      dom.addEventListener('keyup', syncDebounced)
      dom.addEventListener('focus', syncAfterFrame)
      dom.addEventListener('blur', onEditorBlur)
      sync()
    })
    return () => {
      scheduleSyncRef.current = null
      cancelMount()
      document.removeEventListener('selectionchange', syncDebounced)
      window.removeEventListener('pointerup', onWindowPointerEnd)
      window.removeEventListener('pointercancel', onWindowPointerEnd)
      if (editor.mounted) {
        editor.view.dom.removeEventListener('pointerdown', onEditorPointerDown)
        editor.view.dom.removeEventListener('keyup', syncDebounced)
        editor.view.dom.removeEventListener('focus', syncAfterFrame)
        editor.view.dom.removeEventListener('blur', onEditorBlur)
      }
      if (toolbarInteractionFrame !== null) {
        cancelAnimationFrame(toolbarInteractionFrame)
      }
      cancelScheduled()
    }
  }, [editor])

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (closestBlockHandle(event.target, editorHostRoot(editor)) === null) {
        return
      }
      pointerStart.current = { x: event.clientX, y: event.clientY }
      dragStarted.current = false
      // Snapshot before ProseKit selects the hovered node and before the
      // virtual-anchor menu dismisses on this outside press.
      gripPressRange.current = openMenuRangeRef.current
    }
    function onDragStart(event: DragEvent): void {
      if (closestBlockHandle(event.target, editorHostRoot(editor)) !== null) {
        dragStarted.current = true
      }
    }
    function onClick(event: MouseEvent): void {
      const pressRange = gripPressRange.current
      gripPressRange.current = null
      const handle = closestBlockHandle(event.target, editorHostRoot(editor))
      if (handle === null || event.button !== 0) {
        return
      }
      const start = pointerStart.current
      pointerStart.current = null
      if (dragStarted.current) {
        return
      }
      if (
        start !== null &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > HANDLE_CLICK_PX
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (!editor.mounted) {
        return
      }
      const next = readHandleBlockState(editor)
      if (next === null) {
        setHandleMenu(null)
        return
      }
      if (pressRange !== null && pressRange.from === next.from && pressRange.to === next.to) {
        setHandleMenu(null)
        return
      }
      setHandleMenu({ anchor: snapshotAnchor(handle), state: next })
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('dragstart', onDragStart, { capture: true })
    document.addEventListener('click', onClick, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('dragstart', onDragStart, { capture: true })
      document.removeEventListener('click', onClick, { capture: true })
    }
  }, [editor])

  const closeHandleMenu = (): void => {
    setHandleMenu(null)
    if (editor.mounted) {
      setState(readBlockActionState(editor))
    }
  }

  const countLabel =
    state === null ? '' : `${state.count} selected ${state.count === 1 ? 'block' : 'blocks'}`

  return (
    <>
      <DropdownMenu
        open={handleMenu !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeHandleMenu()
            editor.focus()
          }
        }}
      >
        {handleMenu !== null ? (
          <DropdownMenuContent
            align="start"
            anchor={handleMenu.anchor}
            className="w-56 min-w-56"
            data-testid="block-handle-menu"
            side="bottom"
            sideOffset={6}
          >
            <BlockActionMenuItems
              aiEnabled={aiEnabled}
              editor={editor}
              onOpenAi={onOpenAi}
              onRan={closeHandleMenu}
              state={handleMenu.state}
            />
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
      {state !== null && handleMenu === null ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <div
            ref={toolbarRef}
            role="toolbar"
            aria-label={`Block actions for ${countLabel}`}
            onPointerDownCapture={() => {
              interactingWithToolbarRef.current = true
            }}
            onBlur={(event) => {
              const next = event.relatedTarget
              if (
                moreMenuOpenRef.current ||
                (next instanceof Node && (toolbarRef.current?.contains(next) ?? false))
              ) {
                return
              }
              scheduleSyncRef.current?.()
            }}
            className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-popover p-1.5 shadow-pop duration-150 ease-swift"
          >
            {aiEnabled && state.hasText ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Ask AI about ${countLabel}`}
                title="Ask AI"
                onClick={onOpenAi}
              >
                <Sparkles aria-hidden className="size-4 text-accent" />
              </Button>
            ) : null}
            {state.canCycleList ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Change list style for ${countLabel}`}
                title="Change list style"
                onClick={() => {
                  editor.commands.cycleBulletOrderedList()
                  setState(readBlockActionState(editor))
                  editor.focus()
                }}
              >
                <List aria-hidden className="size-4" />
              </Button>
            ) : null}
            {state.canCycleChecklist ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Change checklist style for ${countLabel}`}
                title="Change checklist style"
                onClick={() => {
                  editor.commands.cycleCheckableList()
                  setState(readBlockActionState(editor))
                  editor.focus()
                }}
              >
                <Checklist aria-hidden className="size-4" />
              </Button>
            ) : null}
            <DropdownMenu
              open={moreMenuOpen}
              onOpenChange={(open) => {
                moreMenuOpenRef.current = open
                setMoreMenuOpen(open)
                if (!open) {
                  scheduleSyncRef.current?.()
                }
              }}
            >
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`More actions for ${countLabel}`}
                    title="More block actions"
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="center" side="top" sideOffset={8} className="w-44">
                <BlockActionMenuItems
                  aiEnabled={false}
                  editor={editor}
                  onOpenAi={onOpenAi}
                  onRan={() => setState(readBlockActionState(editor))}
                  state={state}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ) : null}
    </>
  )
}
