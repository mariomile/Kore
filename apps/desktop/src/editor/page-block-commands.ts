import type { Editor } from '@prosekit/core'
import type { EditorExtension } from '@meowdown/core'
import { isPageBlockId, lineBlockId, newPageBlockId } from '@kore/core'
import { Fragment, type Node as ProseMirrorNode, type Schema, type Slice } from '@prosekit/pm/model'
import { TextSelection, type Transaction } from '@prosekit/pm/state'
import { setBlockKind } from './block-kind'
import { pageBlockOf } from './page-block-plugin'

/**
 * The sub-page edits every surface shares (the iPhone action bar, the Mac
 * block menu): turn a block into a page, take a page back to a block, and
 * copy blocks without stealing their ids. A page is a bullet whose first line
 * ends with a hidden `^page-…` id (core `sub-page.ts`).
 */

/**
 * Where a line's trailing `^id` starts and which id it is, read from the
 * line's last text node (an atom after it means it is not at the end), as
 * document positions. Null when the line has none.
 */
export function lineIdTail(
  line: ProseMirrorNode,
  linePos: number,
): { id: string; from: number; to: number } | null {
  const last = line.lastChild
  if (last?.isText !== true) return null
  const text = last.text ?? ''
  const id = lineBlockId(text)
  if (id === null) return null
  const to = linePos + 1 + line.content.size
  const at = text.lastIndexOf(`^${id}`)
  const start = at > 0 && /[ \t]/.test(text[at - 1] ?? '') ? at - 1 : at
  return { id, from: to - (text.length - start), to }
}

/** A page id this document does not use yet. */
export function freshPageId(doc: ProseMirrorNode): string {
  const text = doc.textBetween(0, doc.content.size, '\n', ' ')
  let id = newPageBlockId()
  while (text.includes(`^${id}`)) id = newPageBlockId()
  return id
}

/**
 * A copy of blocks that steals no links: a block id names one line, so the
 * copy drops the ids its lines end with, except a page's, which gets a fresh
 * one (the copy is a page too).
 */
export function copyWithoutLineIds(
  node: ProseMirrorNode,
  schema: Schema,
  fresh: () => string,
): ProseMirrorNode {
  if (node.isTextblock) {
    const last = node.lastChild
    const text = last?.isText === true ? (last.text ?? '') : ''
    const id = lineBlockId(text)
    if (last === null || id === null) return node.copy(node.content)
    const at = text.lastIndexOf(`^${id}`)
    const kept = isPageBlockId(id) ? `${text.slice(0, at)}^${fresh()}` : text.slice(0, at).trimEnd()
    const children: ProseMirrorNode[] = []
    node.forEach((child, _offset, index) => {
      if (index < node.childCount - 1) children.push(child)
    })
    if (kept !== '') children.push(schema.text(kept, last.marks))
    return node.copy(Fragment.from(children))
  }
  const children: ProseMirrorNode[] = []
  node.forEach((child) => {
    children.push(copyWithoutLineIds(child, schema, fresh))
  })
  return node.copy(Fragment.from(children))
}

/** `slice` with its blocks copied by {@link copyWithoutLineIds} (a duplicate). */
export function copySliceWithoutLineIds(
  slice: Slice,
  schema: Schema,
  doc: ProseMirrorNode,
): Fragment {
  const nodes: ProseMirrorNode[] = []
  slice.content.forEach((node) => {
    nodes.push(copyWithoutLineIds(node, schema, () => freshPageId(doc)))
  })
  return Fragment.from(nodes)
}

/**
 * Make the block at `pos` a page, keeping its children. A paragraph, heading
 * or quote becomes a bullet first; a task or numbered item turns bullet.
 * Returns why it could not, or null once it is a page.
 */
export function turnIntoPage(editor: Editor<EditorExtension>, pos: number): string | null {
  const before = editor.state.doc.nodeAt(pos)
  if (before === null) return 'This block cannot be a page.'
  if (pageBlockOf(before, pos) !== null) return null
  if (before.type.name === 'list') {
    if (before.attrs['kind'] !== 'bullet') {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...before.attrs, kind: 'bullet' }),
      )
    }
  } else if (before.isTextblock) {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)),
    )
    setBlockKind(editor, 'bullet')
  } else {
    return 'This block cannot be a page.'
  }
  const list = editor.state.doc.nodeAt(pos)
  const head = list?.type.name === 'list' ? list.firstChild : null
  if (head === null || head === undefined || !head.isTextblock) {
    return 'This block cannot be a page.'
  }
  if (lineIdTail(head, pos + 1) !== null) {
    return 'Other notes link to this line, so it stays a block.'
  }
  const end = pos + 2 + head.content.size
  const gap = head.textContent === '' || /\s$/.test(head.textContent) ? '' : ' '
  editor.view.dispatch(editor.state.tr.insertText(`${gap}^${freshPageId(editor.state.doc)}`, end))
  return null
}

/** `tr` with the page marker of the list at `pos` removed (its children stay). */
export function unmarkPage(tr: Transaction, pos: number): Transaction {
  const node = tr.doc.nodeAt(pos)
  const head = node === null ? null : node.firstChild
  if (node === null || head === null || pageBlockOf(node, pos) === null) return tr
  const tail = lineIdTail(head, pos + 1)
  return tail !== null && isPageBlockId(tail.id) ? tr.delete(tail.from, tail.to) : tr
}
