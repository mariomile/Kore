import { docToMarkdown, type EditorExtension } from '@meowdown/core'
import type { Editor } from '@prosekit/core'
import { TextSelection, type EditorState } from '@prosekit/pm/state'
import { addDays, format } from 'date-fns'
import { startOperation } from '@/lib/operations'
import { setBlockKind } from './block-kind'
import { keepSelected, moveBlocks, siblingMoveTarget, type MoveDirection } from './block-move'
import {
  copyWithoutLineIds,
  freshPageId,
  lineIdTail,
  turnIntoPage,
  unmarkPage,
} from './page-block-commands'
import { allowCaretInPage, pageBlockOf } from './page-block-plugin'
import {
  isListNode,
  selectedBlocks,
  withBlockSelection,
  type BlockRange,
} from './block-selection-plugin'
import type {
  BlockReminder,
  BlockSelectionCommands,
  BlockSelectionState,
} from './block-selection-store'
import { zoomIntoBlockAt } from './block-zoom-plugin'
import type { FormattingBlockKind } from './formatting-toolbar-store'
import { openMoveBranch } from './move-branch-opener'

/**
 * What the block action bar reads and does: the state of the selected blocks
 * and the verbs that act on them, apart from the gestures that select
 * (`block-swipe.tsx`).
 */

function kindOf(range: BlockRange): FormattingBlockKind {
  const name = range.node.type.name
  if (name === 'list') {
    return (range.node.attrs as { kind?: string }).kind === 'task' ? 'task' : 'bullet'
  }
  if (name === 'heading') return 'heading'
  if (name === 'blockquote') return 'quote'
  return 'text'
}

/** The page a selected block is (a list item marked `^page-…`), or null. */
function pageOf(range: BlockRange): ReturnType<typeof pageBlockOf> {
  return pageBlockOf(range.node, range.from)
}

export function readSelectionState(state: EditorState): BlockSelectionState {
  const blocks = selectedBlocks(state)
  const kinds = new Set(blocks.map(kindOf))
  const single = blocks.length === 1 ? blocks[0] : undefined
  const siblings = (range: BlockRange): { before: boolean; nested: boolean } => {
    const $pos = state.doc.resolve(range.from)
    const index = $pos.index()
    const parent = $pos.parent
    const prev = index > 0 ? parent.child(index - 1) : null
    return {
      before: prev !== null && isListNode(prev),
      nested: isListNode(parent),
    }
  }
  const lists = blocks.filter((block) => isListNode(block.node))
  const dates = new Set(
    blocks.map(
      (block) =>
        /\[\[(\d{4}-\d{2}-\d{2})\]\]/.exec(
          block.node.firstChild?.textContent ?? block.node.textContent,
        )?.[1] ?? null,
    ),
  )
  return {
    count: blocks.length,
    kind: kinds.size === 1 ? ([...kinds][0] ?? null) : null,
    canIndent: lists.length === blocks.length && lists.every((block) => siblings(block).before),
    canOutdent: blocks.some((block) => siblings(block).nested),
    canMoveUp: siblingMoveTarget(state.doc, blocks, 'up') !== null,
    canMoveDown: siblingMoveTarget(state.doc, blocks, 'down') !== null,
    date: dates.size === 1 ? ([...dates][0] ?? null) : null,
    isPage: single !== undefined && pageOf(single) !== null,
    hasPage: blocks.some((block) => pageOf(block) !== null),
  }
}

function reminderDate(when: BlockReminder | Date): string {
  if (when instanceof Date) return format(when, 'yyyy-MM-dd')
  const days = when === 'today' ? 0 : when === 'tomorrow' ? 1 : 7
  return format(addDays(new Date(), days), 'yyyy-MM-dd')
}

/**
 * The action bar's verbs for one editor. `askAi` opens the AI menu over the
 * editor's text selection.
 */
export function createBlockSelectionCommands(
  editor: Editor<EditorExtension>,
  askAi: () => void,
): BlockSelectionCommands {
  const view = editor.view

  /** Run `step` with the caret inside each selected block, last block first. */
  const eachBlock = (step: () => void): void => {
    const blocks = selectedBlocks(view.state).reverse()
    for (const block of blocks) {
      const near = TextSelection.near(view.state.doc.resolve(block.from + 1), 1)
      view.dispatch(allowCaretInPage(view.state.tr.setSelection(near)))
      step()
    }
    // The caret moved for the commands' sake; the keyboard stays down.
    if (view.hasFocus()) editor.blur()
  }

  /** Drop the page marker from every selected page (one undoable step). */
  const unmarkPages = (): void => {
    let tr = view.state.tr
    for (const block of selectedBlocks(view.state).reverse()) tr = unmarkPage(tr, block.from)
    if (tr.docChanged) view.dispatch(tr)
  }

  /** Step the selected blocks one place among their siblings. */
  const step = (direction: MoveDirection): void => {
    const blocks = selectedBlocks(view.state)
    const target = siblingMoveTarget(view.state.doc, blocks, direction)
    const move = target === null ? null : moveBlocks(view.state, blocks, target)
    if (move === null) return
    view.dispatch(keepSelected(move).scrollIntoView())
  }

  return {
    setKind: (kind) => {
      // Any kind takes a page back to an ordinary block: the marker goes,
      // the children stay where they are.
      unmarkPages()
      eachBlock(() => setBlockKind(editor, kind))
    },
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
          view.dispatch(view.state.tr.insertText(`[[${date}]]`, from, from + existing[0].length))
          return
        }
        // Before a hidden `^id`, which must stay last on the line.
        const tail = lineIdTail($from.parent, $from.before())
        const at = tail === null ? end : tail.from
        const before = view.state.doc.textBetween($from.start(), at)
        const lead = before.length > 0 && !before.endsWith(' ') ? ' ' : ''
        view.dispatch(view.state.tr.insertText(`${lead}[[${date}]]`, at))
      })
    },
    indent: () => eachBlock(() => editor.commands.indentList()),
    outdent: () => eachBlock(() => editor.commands.dedentList()),
    moveUp: () => step('up'),
    moveDown: () => step('down'),
    duplicate: () => {
      const blocks = selectedBlocks(view.state).reverse()
      let tr = view.state.tr
      const { schema } = view.state
      for (const block of blocks) {
        const fresh = (): string => freshPageId(tr.doc)
        tr = tr.insert(block.to, copyWithoutLineIds(block.node, schema, fresh))
      }
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
      const picked = blocks[0]
      if (picked === undefined || blocks.length !== 1 || pageOf(picked) !== null) return
      view.dispatch(withBlockSelection(view.state.tr, { type: 'clear' }))
      const why = turnIntoPage(editor, picked.from)
      if (why !== null) startOperation('Turning into a page').fail(why)
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
      view.dispatch(withBlockSelection(view.state.tr.setSelection(selection), { type: 'clear' }))
      view.focus()
      askAi()
    },
    clear: () => view.dispatch(withBlockSelection(view.state.tr, { type: 'clear' })),
  }
}
