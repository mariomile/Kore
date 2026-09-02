import { useLayoutEffect, useState, type ReactElement } from 'react'
import { useEditor } from '@meowdown/react'
import type { EditorExtension, TypedEditor } from '@meowdown/core'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Checklist,
  Copy,
  List,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { whenEditorMounted } from './when-editor-mounted'

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

function selectionType(selection: { toJSON(): unknown }): unknown {
  const json = selection.toJSON()
  return typeof json === 'object' && json !== null && 'type' in json ? json.type : undefined
}

function selectedBlockRange(editor: TypedEditor): SelectedBlockRange | null {
  const { doc, selection } = editor.state
  const type = selectionType(selection)

  if (type === 'node') {
    return { count: 1, from: selection.from, to: selection.to }
  }

  if (selection.empty) {
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

function readBlockActionState(editor: TypedEditor): BlockActionState | null {
  const range = selectedBlockRange(editor)
  if (range === null) {
    return null
  }
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

interface BlockActionToolbarProps {
  /** Whether this note may send its selected content to the configured AI provider. */
  aiEnabled: boolean
  /** Open Meowdown's existing selection-prompt menu over the current selection. */
  onOpenAi: () => void
}

/** Bottom-centered actions for one selected block or a selection spanning several blocks. */
export function BlockActionToolbar({
  aiEnabled,
  onOpenAi,
}: BlockActionToolbarProps): ReactElement | null {
  const editor = useEditor<EditorExtension>()
  const [state, setState] = useState<BlockActionState | null>(null)

  useLayoutEffect(() => {
    let observer: MutationObserver | null = null
    let syncFrame: number | null = null

    function sync(): void {
      if (!editor.mounted) {
        return
      }
      setState((current) => {
        const next = readBlockActionState(editor)
        return statesEqual(current, next) ? current : next
      })
    }

    function syncAfterEditor(): void {
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame)
      }
      syncFrame = requestAnimationFrame(() => {
        syncFrame = null
        sync()
      })
    }

    const cancelMount = whenEditorMounted(editor, () => {
      const dom = editor.view.dom
      document.addEventListener('selectionchange', syncAfterEditor)
      dom.addEventListener('keyup', syncAfterEditor)
      dom.addEventListener('pointerup', syncAfterEditor)
      observer = new MutationObserver(syncAfterEditor)
      // Node selections are painted by toggling `ProseMirror-selectednode`.
      // Inline and multi-block text selections arrive through `selectionchange`.
      observer.observe(dom, { attributeFilter: ['class'], attributes: true, subtree: true })
      sync()
    })
    return () => {
      cancelMount()
      document.removeEventListener('selectionchange', syncAfterEditor)
      if (editor.mounted) {
        editor.view.dom.removeEventListener('keyup', syncAfterEditor)
        editor.view.dom.removeEventListener('pointerup', syncAfterEditor)
      }
      observer?.disconnect()
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame)
      }
    }
  }, [editor])

  if (state === null) {
    return null
  }

  const run = (command: () => void): void => {
    command()
    setState(readBlockActionState(editor))
    editor.focus()
  }
  const duplicate = (): void => {
    const { from, to } = state
    const slice = editor.state.doc.slice(from, to)
    editor.view.dispatch(editor.state.tr.replaceRange(to, to, slice).scrollIntoView())
    setState(readBlockActionState(editor))
    editor.focus()
  }
  const remove = (): void => {
    editor.view.dispatch(editor.state.tr.delete(state.from, state.to).scrollIntoView())
    setState(readBlockActionState(editor))
    editor.focus()
  }
  const countLabel = `${state.count} selected ${state.count === 1 ? 'block' : 'blocks'}`

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div
        role="toolbar"
        aria-label={`Block actions for ${countLabel}`}
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
            onClick={() => run(() => editor.commands.cycleBulletOrderedList())}
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
            onClick={() => run(() => editor.commands.cycleCheckableList())}
          >
            <Checklist aria-hidden className="size-4" />
          </Button>
        ) : null}
        <DropdownMenu>
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
            {state.canIndent || state.canDedent || state.canMoveUp || state.canMoveDown ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem onClick={duplicate}>
              <Copy aria-hidden />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={remove}>
              <Trash aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
